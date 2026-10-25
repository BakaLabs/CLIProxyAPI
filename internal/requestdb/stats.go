package requestdb

import (
	"context"
	"fmt"
	"math"
	"sort"
)

// maxPercentileRows caps the exact percentile scan. Beyond it the latency /
// TTFT / TPS percentiles are computed on a rowid-modulo sample (~200k rows)
// and the corresponding Sampled flags are set, so callers can label the
// numbers instead of silently degrading.
const maxPercentileRows = 200_000

// tpsBucketEdges are the upper bounds of the TPS histogram buckets (output
// tokens per second); the last bucket is unbounded.
var tpsBucketEdges = []float64{1, 5, 10, 20, 50, 100, 200, 500}

// Stats is the aggregate summary of one filtered request range.
type Stats struct {
	TotalRequests  int64 `json:"total_requests"`
	FailedRequests int64 `json:"failed_requests"`
	StreamRequests int64 `json:"stream_requests"`

	InputTokens         int64 `json:"input_tokens"`
	OutputTokens        int64 `json:"output_tokens"`
	ReasoningTokens     int64 `json:"reasoning_tokens"`
	CachedTokens        int64 `json:"cached_tokens"`
	CacheReadTokens     int64 `json:"cache_read_tokens"`
	CacheCreationTokens int64 `json:"cache_creation_tokens"`
	TotalTokens         int64 `json:"total_tokens"`

	UniqueModels    int64 `json:"unique_models"`
	UniqueProviders int64 `json:"unique_providers"`
	UniqueAPIKeys   int64 `json:"unique_api_keys"`
	UniqueSessions  int64 `json:"unique_sessions"`

	FirstRequestMS int64 `json:"first_request_ms"`
	LastRequestMS  int64 `json:"last_request_ms"`

	LatencyAvgMS   float64 `json:"latency_avg_ms"`
	LatencyP50MS   int64   `json:"latency_p50_ms"`
	LatencyP90MS   int64   `json:"latency_p90_ms"`
	LatencyP99MS   int64   `json:"latency_p99_ms"`
	LatencySampled bool    `json:"latency_sampled"`

	// TTFT statistics only cover streaming rows that reported a first-token time.
	TTFTRequests int64   `json:"ttft_requests"`
	TTFTAvgMS    float64 `json:"ttft_avg_ms"`
	TTFTP50MS    int64   `json:"ttft_p50_ms"`
	TTFTP90MS    int64   `json:"ttft_p90_ms"`
	TTFTSampled  bool    `json:"ttft_sampled"`

	// TPS (output tokens per second) covers successful rows with positive
	// output tokens and latency. TPSAvg is aggregate throughput:
	// SUM(output_tokens) / SUM(latency seconds).
	TPSRows      int64       `json:"tps_rows"`
	TPSAvg       float64     `json:"tps_avg"`
	TPSP50       float64     `json:"tps_p50"`
	TPSP90       float64     `json:"tps_p90"`
	TPSSampled   bool        `json:"tps_sampled"`
	TPSHistogram []TPSBucket `json:"tps_histogram"`
}

// TPSBucket is one histogram bucket of per-request TPS values.
type TPSBucket struct {
	Label string `json:"label"`
	Count int64  `json:"count"`
}

// TimeseriesPoint is one interval bucket of the time-series aggregation.
type TimeseriesPoint struct {
	BucketMS     int64   `json:"bucket_ms"`
	Requests     int64   `json:"requests"`
	Failed       int64   `json:"failed"`
	InputTokens  int64   `json:"input_tokens"`
	OutputTokens int64   `json:"output_tokens"`
	TotalTokens  int64   `json:"total_tokens"`
	LatencyAvgMS float64 `json:"latency_avg_ms"`
	TTFTAvgMS    float64 `json:"ttft_avg_ms"`
	// TPSAvg is aggregate throughput within the bucket:
	// SUM(output_tokens) / SUM(latency seconds) over successful rows.
	TPSAvg float64 `json:"tps_avg"`
}

// BreakdownRow is one group of the group-by aggregation.
type BreakdownRow struct {
	Key          string  `json:"key"`
	Requests     int64   `json:"requests"`
	Failed       int64   `json:"failed"`
	InputTokens  int64   `json:"input_tokens"`
	OutputTokens int64   `json:"output_tokens"`
	TotalTokens  int64   `json:"total_tokens"`
	LatencyAvgMS float64 `json:"latency_avg_ms"`
	TPSAvg       float64 `json:"tps_avg"`
}

// breakdownColumns whitelists the group-by dimensions to interpolated SQL
// expressions. status_code is only meaningful on failures (success rows are
// stored as 200).
var breakdownColumns = map[string]string{
	"model":       "model",
	"provider":    "provider",
	"api_key":     "api_key",
	"auth_id":     "auth_id",
	"session_id":  "session_id",
	"status_code": "CAST(status_code AS TEXT)",
}

// Stats returns the aggregate summary for the filtered range. Pagination and
// keyset fields of the Query are ignored.
func (s *Store) Stats(ctx context.Context, q Query) (*Stats, error) {
	if s == nil || s.db == nil {
		return nil, ErrDisabled
	}
	where, args := buildWhere(q)

	summary := `SELECT COUNT(*), COALESCE(SUM(failed),0), COALESCE(SUM(stream),0),
		COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(reasoning_tokens),0),
		COALESCE(SUM(cached_tokens),0), COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cache_creation_tokens),0),
		COALESCE(SUM(total_tokens),0),
		COUNT(DISTINCT NULLIF(model,'')), COUNT(DISTINCT NULLIF(provider,'')),
		COUNT(DISTINCT NULLIF(api_key,'')), COUNT(DISTINCT NULLIF(session_id,'')),
		COALESCE(MIN(requested_at),0), COALESCE(MAX(requested_at),0),
		COALESCE(AVG(latency_ms),0),
		COALESCE(SUM(CASE WHEN stream=1 AND ttft_ms>0 THEN 1 ELSE 0 END),0),
		COALESCE(AVG(CASE WHEN stream=1 AND ttft_ms>0 THEN ttft_ms END),0),
		COALESCE(SUM(CASE WHEN failed=0 AND latency_ms>0 THEN output_tokens ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN failed=0 AND latency_ms>0 THEN latency_ms ELSE 0 END),0)
		FROM request_logs` + where
	var st Stats
	var latencyAvg, ttftAvg, tpsOutputSum, tpsLatencySum float64
	if err := s.db.QueryRowContext(ctx, summary, args...).Scan(
		&st.TotalRequests, &st.FailedRequests, &st.StreamRequests,
		&st.InputTokens, &st.OutputTokens, &st.ReasoningTokens,
		&st.CachedTokens, &st.CacheReadTokens, &st.CacheCreationTokens,
		&st.TotalTokens,
		&st.UniqueModels, &st.UniqueProviders, &st.UniqueAPIKeys, &st.UniqueSessions,
		&st.FirstRequestMS, &st.LastRequestMS,
		&latencyAvg,
		&st.TTFTRequests, &ttftAvg,
		&tpsOutputSum, &tpsLatencySum,
	); err != nil {
		return nil, fmt.Errorf("requestdb: aggregate stats: %w", err)
	}
	st.LatencyAvgMS = latencyAvg
	st.TTFTAvgMS = ttftAvg
	if tpsLatencySum > 0 {
		st.TPSAvg = tpsOutputSum / (tpsLatencySum / 1000)
	}

	if err := s.scanPercentiles(ctx, where, args, st.TotalRequests, &st); err != nil {
		return nil, err
	}
	return &st, nil
}

// scanPercentiles fills latency/TTFT/TPS percentiles and the TPS histogram,
// sampling by rowid modulo when the range exceeds maxPercentileRows.
func (s *Store) scanPercentiles(ctx context.Context, where string, args []any, total int64, st *Stats) error {
	sampled := false
	scanArgs := args
	percentileWhere := where
	if total > maxPercentileRows {
		step := (total + maxPercentileRows - 1) / maxPercentileRows
		if where == "" {
			percentileWhere = " WHERE (id % ?) = 0"
		} else {
			percentileWhere = where + " AND (id % ?) = 0"
		}
		scanArgs = append(append([]any{}, args...), step)
		sampled = true
	}

	stmt := `SELECT id, latency_ms, stream, ttft_ms, failed, output_tokens FROM request_logs` + percentileWhere
	rows, err := s.db.QueryContext(ctx, stmt, scanArgs...)
	if err != nil {
		return fmt.Errorf("requestdb: scan percentile rows: %w", err)
	}
	defer func() { _ = rows.Close() }()

	latencies := make([]int64, 0, 1024)
	ttfts := make([]int64, 0, 1024)
	tpsValues := make([]float64, 0, 1024)
	tpsCounts := make([]int64, len(tpsBucketEdges)+1)
	for rows.Next() {
		var id, latencyMS, ttftMS, output int64
		var stream, failed int
		if errScan := rows.Scan(&id, &latencyMS, &stream, &ttftMS, &failed, &output); errScan != nil {
			return fmt.Errorf("requestdb: scan percentile row: %w", errScan)
		}
		latencies = append(latencies, latencyMS)
		if stream == 1 && ttftMS > 0 {
			ttfts = append(ttfts, ttftMS)
		}
		if failed == 0 && latencyMS > 0 && output > 0 {
			tps := float64(output) / (float64(latencyMS) / 1000)
			tpsValues = append(tpsValues, tps)
			tpsCounts[bucketIndex(tps)]++
		}
	}
	if errRows := rows.Err(); errRows != nil {
		return fmt.Errorf("requestdb: iterate percentile rows: %w", errRows)
	}

	st.LatencySampled = sampled
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	st.LatencyP50MS = percentileInt(latencies, 50)
	st.LatencyP90MS = percentileInt(latencies, 90)
	st.LatencyP99MS = percentileInt(latencies, 99)

	st.TTFTSampled = sampled
	sort.Slice(ttfts, func(i, j int) bool { return ttfts[i] < ttfts[j] })
	st.TTFTP50MS = percentileInt(ttfts, 50)
	st.TTFTP90MS = percentileInt(ttfts, 90)

	st.TPSSampled = sampled
	st.TPSRows = int64(len(tpsValues))
	sort.Slice(tpsValues, func(i, j int) bool { return tpsValues[i] < tpsValues[j] })
	st.TPSP50 = percentileFloat(tpsValues, 50)
	st.TPSP90 = percentileFloat(tpsValues, 90)
	st.TPSHistogram = make([]TPSBucket, 0, len(tpsCounts))
	for i, count := range tpsCounts {
		st.TPSHistogram = append(st.TPSHistogram, TPSBucket{Label: tpsBucketLabel(i), Count: count})
	}
	return nil
}

// bucketIndex maps a TPS value onto the fixed histogram bucket edges.
func bucketIndex(tps float64) int {
	for i, edge := range tpsBucketEdges {
		if tps < edge {
			return i
		}
	}
	return len(tpsBucketEdges)
}

func tpsBucketLabel(i int) string {
	switch {
	case i == 0:
		return "<1"
	case i == len(tpsBucketEdges):
		return "500+"
	default:
		return fmt.Sprintf("%g-%g", tpsBucketEdges[i-1], tpsBucketEdges[i])
	}
}

func percentileInt(sorted []int64, p float64) int64 {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	rank := int(math.Ceil(p / 100 * float64(n)))
	if rank < 1 {
		rank = 1
	}
	if rank > n {
		rank = n
	}
	return sorted[rank-1]
}

func percentileFloat(sorted []float64, p float64) float64 {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	rank := int(math.Ceil(p / 100 * float64(n)))
	if rank < 1 {
		rank = 1
	}
	if rank > n {
		rank = n
	}
	return sorted[rank-1]
}

// Timeseries aggregates the filtered range into fixed-width interval buckets.
// intervalMS must be positive; buckets with no rows are absent from the result.
func (s *Store) Timeseries(ctx context.Context, q Query, intervalMS int64) ([]TimeseriesPoint, error) {
	if s == nil || s.db == nil {
		return nil, ErrDisabled
	}
	if intervalMS <= 0 {
		return nil, fmt.Errorf("requestdb: interval must be positive")
	}
	where, args := buildWhere(q)
	stmt := `SELECT (requested_at / ?) * ? AS bucket, COUNT(*), COALESCE(SUM(failed),0),
		COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(total_tokens),0),
		COALESCE(AVG(latency_ms),0),
		COALESCE(AVG(CASE WHEN stream=1 AND ttft_ms>0 THEN ttft_ms END),0),
		COALESCE(SUM(CASE WHEN failed=0 THEN output_tokens ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN failed=0 THEN latency_ms ELSE 0 END),0)
		FROM request_logs` + where + ` GROUP BY bucket ORDER BY bucket`
	allArgs := append([]any{intervalMS, intervalMS}, args...)
	rows, err := s.db.QueryContext(ctx, stmt, allArgs...)
	if err != nil {
		return nil, fmt.Errorf("requestdb: aggregate timeseries: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []TimeseriesPoint
	for rows.Next() {
		var p TimeseriesPoint
		var outputSum, latencySum float64
		if errScan := rows.Scan(&p.BucketMS, &p.Requests, &p.Failed,
			&p.InputTokens, &p.OutputTokens, &p.TotalTokens,
			&p.LatencyAvgMS, &p.TTFTAvgMS, &outputSum, &latencySum); errScan != nil {
			return nil, fmt.Errorf("requestdb: scan timeseries row: %w", errScan)
		}
		if latencySum > 0 {
			p.TPSAvg = outputSum / (latencySum / 1000)
		}
		out = append(out, p)
	}
	if errRows := rows.Err(); errRows != nil {
		return nil, fmt.Errorf("requestdb: iterate timeseries rows: %w", errRows)
	}
	return out, nil
}

// Breakdown groups the filtered range by one dimension and returns the top
// groups ordered by request count. dimension is whitelisted; limit defaults
// to 10 and is capped at 100.
func (s *Store) Breakdown(ctx context.Context, q Query, dimension string, limit int) ([]BreakdownRow, error) {
	if s == nil || s.db == nil {
		return nil, ErrDisabled
	}
	column, ok := breakdownColumns[dimension]
	if !ok {
		return nil, fmt.Errorf("requestdb: unknown breakdown dimension %q", dimension)
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	where, args := buildWhere(q)
	stmt := `SELECT ` + column + `, COUNT(*), COALESCE(SUM(failed),0),
		COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(total_tokens),0),
		COALESCE(AVG(latency_ms),0),
		COALESCE(SUM(CASE WHEN failed=0 THEN output_tokens ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN failed=0 THEN latency_ms ELSE 0 END),0)
		FROM request_logs` + where + ` GROUP BY ` + column + ` ORDER BY COUNT(*) DESC LIMIT ?`
	allArgs := append(args, limit)
	rows, err := s.db.QueryContext(ctx, stmt, allArgs...)
	if err != nil {
		return nil, fmt.Errorf("requestdb: aggregate breakdown: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := make([]BreakdownRow, 0, limit)
	for rows.Next() {
		var r BreakdownRow
		var outputSum, latencySum float64
		if errScan := rows.Scan(&r.Key, &r.Requests, &r.Failed,
			&r.InputTokens, &r.OutputTokens, &r.TotalTokens,
			&r.LatencyAvgMS, &outputSum, &latencySum); errScan != nil {
			return nil, fmt.Errorf("requestdb: scan breakdown row: %w", errScan)
		}
		if latencySum > 0 {
			r.TPSAvg = outputSum / (latencySum / 1000)
		}
		out = append(out, r)
	}
	if errRows := rows.Err(); errRows != nil {
		return nil, fmt.Errorf("requestdb: iterate breakdown rows: %w", errRows)
	}
	return out, nil
}

// TailBacklog returns the newest limit entries matching q, oldest first.
// It backs the SSE live-tail replay on connect.
func TailBacklog(ctx context.Context, q Query, limit int) ([]Entry, error) {
	mgr := activeManager()
	if mgr == nil {
		return nil, ErrDisabled
	}
	return mgr.store.TailBacklog(ctx, q, limit)
}

// tailBacklog returns the newest limit entries matching q, oldest first.
func (s *Store) TailBacklog(ctx context.Context, q Query, limit int) ([]Entry, error) {
	if limit <= 0 {
		return nil, nil
	}
	q.BeforeID = 0
	q.Limit = limit
	q.Offset = 0
	entries, err := s.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}
	return entries, nil
}

// GetStats returns the aggregate summary for the filtered range.
func GetStats(ctx context.Context, q Query) (*Stats, error) {
	mgr := activeManager()
	if mgr == nil {
		return nil, ErrDisabled
	}
	return mgr.store.Stats(ctx, q)
}

// GetTimeseries returns fixed-width interval buckets for the filtered range.
func GetTimeseries(ctx context.Context, q Query, intervalMS int64) ([]TimeseriesPoint, error) {
	mgr := activeManager()
	if mgr == nil {
		return nil, ErrDisabled
	}
	return mgr.store.Timeseries(ctx, q, intervalMS)
}

// GetBreakdown returns top groups of one dimension for the filtered range.
func GetBreakdown(ctx context.Context, q Query, dimension string, limit int) ([]BreakdownRow, error) {
	mgr := activeManager()
	if mgr == nil {
		return nil, ErrDisabled
	}
	return mgr.store.Breakdown(ctx, q, dimension, limit)
}

func activeManager() *manager {
	mu.Lock()
	mgr := active
	mu.Unlock()
	return mgr
}
