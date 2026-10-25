package management

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/requestdb"
)

const (
	defaultStreamBacklog = 100
	streamHeartbeatEvery = 15 * time.Second
	// defaultTimeseriesRangeMS backs the timeseries endpoint when the caller
	// sends no from/to bounds; the stats endpoint aggregates the whole table.
	defaultTimeseriesRangeMS = 24 * time.Hour
)

// parseRequestDBFilter fills the equality and range filters of a Query from
// the request; paging fields are left zero.
func parseRequestDBFilter(c *gin.Context) (requestdb.Query, error) {
	query := requestdb.Query{}
	query.Model = strings.TrimSpace(c.Query("model"))
	query.APIKey = strings.TrimSpace(c.Query("api_key"))
	query.Provider = strings.TrimSpace(c.Query("provider"))
	query.SessionID = strings.TrimSpace(c.Query("session_id"))
	query.RequestID = strings.TrimSpace(c.Query("request_id"))
	query.TraceID = strings.TrimSpace(c.Query("trace_id"))
	if raw := strings.TrimSpace(c.Query("failed")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return query, errors.New("failed must be true or false")
		}
		query.Failed = &parsed
	}
	if raw := strings.TrimSpace(c.Query("status_code")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			return query, errors.New("status_code must be a positive integer")
		}
		query.StatusCode = parsed
	}
	if raw := strings.TrimSpace(c.Query("from")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			return query, errors.New("from must be a non-negative unix millisecond timestamp")
		}
		query.FromMS = parsed
	}
	if raw := strings.TrimSpace(c.Query("to")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			return query, errors.New("to must be a non-negative unix millisecond timestamp")
		}
		query.ToMS = parsed
	}
	return query, nil
}

// GetRequestDBStats returns the aggregate summary (counts, tokens, latency /
// TTFT / TPS percentiles, TPS histogram) for the filtered range.
func (h *Handler) GetRequestDBStats(c *gin.Context) {
	query, errParse := parseRequestDBFilter(c)
	if errParse != nil {
		c.JSON(400, gin.H{"error": errParse.Error()})
		return
	}
	stats, errQuery := requestdb.GetStats(c.Request.Context(), query)
	if errQuery != nil {
		c.JSON(requestDBErrorStatus(errQuery), gin.H{"error": errQuery.Error()})
		return
	}
	c.JSON(200, stats)
}

// GetRequestDBTimeseries returns fixed-width interval buckets for the filtered
// range. interval (seconds) may be given explicitly; otherwise it is chosen so
// the range yields roughly 60-100 buckets. Without from/to the default range
// is the last 24 hours.
func (h *Handler) GetRequestDBTimeseries(c *gin.Context) {
	query, errParse := parseRequestDBFilter(c)
	if errParse != nil {
		c.JSON(400, gin.H{"error": errParse.Error()})
		return
	}
	if query.FromMS <= 0 && query.ToMS <= 0 {
		query.ToMS = time.Now().UnixMilli()
		query.FromMS = query.ToMS - defaultTimeseriesRangeMS.Milliseconds()
	} else if query.FromMS <= 0 {
		query.FromMS = query.ToMS - defaultTimeseriesRangeMS.Milliseconds()
	} else if query.ToMS <= 0 {
		query.ToMS = time.Now().UnixMilli()
	}
	interval := autoTimeseriesIntervalMS(query.ToMS - query.FromMS)
	if raw := strings.TrimSpace(c.Query("interval")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed <= 0 {
			c.JSON(400, gin.H{"error": "interval must be a positive number of seconds"})
			return
		}
		interval = parsed * 1000
	}
	points, errQuery := requestdb.GetTimeseries(c.Request.Context(), query, interval)
	if errQuery != nil {
		c.JSON(requestDBErrorStatus(errQuery), gin.H{"error": errQuery.Error()})
		return
	}
	c.JSON(200, gin.H{
		"interval_ms": interval,
		"from_ms":     query.FromMS,
		"to_ms":       query.ToMS,
		"points":      points,
	})
}

// autoTimeseriesIntervalMS picks a human-friendly bucket width that yields
// roughly 60-100 buckets over the requested range.
func autoTimeseriesIntervalMS(rangeMS int64) int64 {
	if rangeMS <= 0 {
		rangeMS = defaultTimeseriesRangeMS.Milliseconds()
	}
	steps := []int64{
		60_000, 300_000, 900_000, 1_800_000, 3_600_000,
		10_800_000, 21_600_000, 43_200_000, 86_400_000,
	}
	target := rangeMS / 90
	for _, step := range steps {
		if step >= target {
			return step
		}
	}
	return steps[len(steps)-1]
}

// GetRequestDBBreakdown returns the top groups of one dimension
// (model|provider|api_key|auth_id|session_id) for the filtered range.
func (h *Handler) GetRequestDBBreakdown(c *gin.Context) {
	query, errParse := parseRequestDBFilter(c)
	if errParse != nil {
		c.JSON(400, gin.H{"error": errParse.Error()})
		return
	}
	dimension := strings.TrimSpace(c.Query("dimension"))
	if dimension == "" {
		c.JSON(400, gin.H{"error": "dimension is required (model, provider, api_key, auth_id, session_id)"})
		return
	}
	limit := 10
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			c.JSON(400, gin.H{"error": "limit must be a positive integer"})
			return
		}
		limit = parsed
	}
	rows, errQuery := requestdb.GetBreakdown(c.Request.Context(), query, dimension, limit)
	if errQuery != nil {
		c.JSON(requestDBErrorStatus(errQuery), gin.H{"error": errQuery.Error()})
		return
	}
	c.JSON(200, gin.H{"dimension": dimension, "rows": rows})
}

// GetRequestDBStream pushes live request records as server-sent events.
// Event types: "backlog" ({"records":[...]}) replayed on connect (oldest
// event first), "request" (one record) for live entries, and ": ping"
// comment heartbeats. When the server-side buffer overflows the stream is
// closed; clients reconnect and re-play the backlog.
func (h *Handler) GetRequestDBStream(c *gin.Context) {
	filter, errParse := parseRequestDBFilter(c)
	if errParse != nil {
		c.JSON(400, gin.H{"error": errParse.Error()})
		return
	}
	sub := requestdb.SubscribeStream(filter)
	defer requestdb.UnsubscribeStream(sub)

	writer := c.Writer
	header := writer.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-store")
	header.Set("Connection", "keep-alive")
	header.Set("X-Accel-Buffering", "no")
	writer.WriteHeader(200)

	// Replay the recent backlog; live-only when the store is disabled. The
	// subscription is active already, so the client deduplicates by record id.
	backlog, errBacklog := requestdb.TailBacklog(c.Request.Context(), filter, defaultStreamBacklog)
	if errBacklog == nil && len(backlog) > 0 {
		records := make([]requestDBRecordResponse, 0, len(backlog))
		for i := range backlog {
			records = append(records, newRequestDBRecordResponse(&backlog[i], false))
		}
		if !writeSSEEvent(writer, "backlog", gin.H{"records": records}) {
			return
		}
	}

	ticker := time.NewTicker(streamHeartbeatEvery)
	defer ticker.Stop()
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			if _, err := writer.WriteString(": ping\n\n"); err != nil {
				return
			}
			writer.Flush()
		case entry, ok := <-sub.Channel():
			if !ok {
				// Dropped as a slow consumer; the client reconnects.
				return
			}
			if !writeSSEEvent(writer, "request", newRequestDBRecordResponse(entry, false)) {
				return
			}
		}
	}
}

// writeSSEEvent writes one named SSE event and flushes; false on client disconnect.
func writeSSEEvent(writer gin.ResponseWriter, event string, payload any) bool {
	data, err := json.Marshal(payload)
	if err != nil {
		// Marshaling cannot fail for these shapes; keep the stream alive.
		return true
	}
	if _, err = writer.WriteString("event: " + event + "\ndata: " + string(data) + "\n\n"); err != nil {
		return false
	}
	writer.Flush()
	return true
}
