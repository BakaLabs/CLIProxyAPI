package requestdb

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

// newTestStore opens a store backed by a temp file.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func mustInsertBatch(t *testing.T, store *Store, entries []Entry) {
	t.Helper()
	if err := store.InsertBatch(context.Background(), entries); err != nil {
		t.Fatalf("insert batch: %v", err)
	}
}

// statsFixture returns entries exercising token sums, streaming, failures,
// TPS and latency spread. IDs are assigned by insertion order (1-based).
func statsFixture() []Entry {
	return []Entry{
		{RequestedAtMS: 1000, TraceID: "t1", Model: "gpt-4o", Provider: "openai", APIKey: "k1",
			Stream: true, LatencyMS: 2000, TTFTMS: 200, InputTokens: 100, OutputTokens: 200, TotalTokens: 300},
		{RequestedAtMS: 2000, TraceID: "t9", Model: "gpt-4o", Provider: "openai", APIKey: "k1",
			LatencyMS: 1000, OutputTokens: 50, TotalTokens: 50},
		{RequestedAtMS: 3000, TraceID: "t1", Model: "claude-3", Provider: "anthropic", APIKey: "k2",
			Failed: true, StatusCode: 429, LatencyMS: 500},
		{RequestedAtMS: 4000, TraceID: "t2", Model: "claude-3", Provider: "anthropic", APIKey: "k2",
			Stream: true, LatencyMS: 3000, TTFTMS: 500, OutputTokens: 300, TotalTokens: 300},
		{RequestedAtMS: 5000, TraceID: "t2", Model: "gpt-4o-mini", Provider: "openai", APIKey: "k1",
			LatencyMS: 500, OutputTokens: 10, TotalTokens: 10},
	}
}

func TestStatsAggregation(t *testing.T) {
	store := newTestStore(t)
	mustInsertBatch(t, store, statsFixture())

	stats, err := store.Stats(context.Background(), Query{})
	if err != nil {
		t.Fatalf("stats: %v", err)
	}

	if stats.TotalRequests != 5 || stats.FailedRequests != 1 || stats.StreamRequests != 2 {
		t.Errorf("counts = (%d, %d, %d), want (5, 1, 2)", stats.TotalRequests, stats.FailedRequests, stats.StreamRequests)
	}
	if stats.InputTokens != 100 || stats.OutputTokens != 560 || stats.TotalTokens != 660 {
		t.Errorf("token sums = (%d, %d, %d), want (100, 560, 660)", stats.InputTokens, stats.OutputTokens, stats.TotalTokens)
	}
	if stats.UniqueModels != 3 || stats.UniqueProviders != 2 || stats.UniqueAPIKeys != 2 || stats.UniqueSessions != 0 {
		t.Errorf("uniques = (%d, %d, %d, %d), want (3, 2, 2, 0)",
			stats.UniqueModels, stats.UniqueProviders, stats.UniqueAPIKeys, stats.UniqueSessions)
	}
	if stats.FirstRequestMS != 1000 || stats.LastRequestMS != 5000 {
		t.Errorf("time bounds = (%d, %d), want (1000, 5000)", stats.FirstRequestMS, stats.LastRequestMS)
	}
	if stats.LatencyP50MS != 1000 || stats.LatencyP90MS != 3000 || stats.LatencyP99MS != 3000 {
		t.Errorf("latency percentiles = (%d, %d, %d), want (1000, 3000, 3000)",
			stats.LatencyP50MS, stats.LatencyP90MS, stats.LatencyP99MS)
	}
	if stats.TTFTRequests != 2 || stats.TTFTP50MS != 200 || stats.TTFTP90MS != 500 {
		t.Errorf("ttft = (%d, %d, %d), want (2, 200, 500)", stats.TTFTRequests, stats.TTFTP50MS, stats.TTFTP90MS)
	}
	// Per-row TPS values: 100, 50, 100, 20. Aggregate: 560 output / 6.5s.
	if stats.TPSRows != 4 {
		t.Errorf("tps rows = %d, want 4", stats.TPSRows)
	}
	if stats.TPSP50 != 50 || stats.TPSP90 != 100 {
		t.Errorf("tps percentiles = (%f, %f), want (50, 100)", stats.TPSP50, stats.TPSP90)
	}
	wantTPSAvg := 560 / 6.5
	if diff := stats.TPSAvg - wantTPSAvg; diff > 0.01 || diff < -0.01 {
		t.Errorf("tps avg = %f, want %f", stats.TPSAvg, wantTPSAvg)
	}
	expectBuckets := map[string]int64{"20-50": 1, "50-100": 1, "100-200": 2}
	for _, bucket := range stats.TPSHistogram {
		if want := expectBuckets[bucket.Label]; bucket.Count != want {
			t.Errorf("bucket %q = %d, want %d", bucket.Label, bucket.Count, want)
		}
	}
}

func TestStatsFilterAndSampling(t *testing.T) {
	store := newTestStore(t)
	mustInsertBatch(t, store, statsFixture())

	failedOnly := true
	stats, err := store.Stats(context.Background(), Query{Failed: &failedOnly})
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.TotalRequests != 1 || stats.FailedRequests != 1 {
		t.Errorf("failed-only stats = (%d, %d), want (1, 1)", stats.TotalRequests, stats.FailedRequests)
	}
	if stats.OutputTokens != 0 || stats.TPSRows != 0 {
		t.Errorf("failed-only tps = (%d tokens, %d rows), want (0, 0)", stats.OutputTokens, stats.TPSRows)
	}
}

func TestTimeseries(t *testing.T) {
	store := newTestStore(t)
	mustInsertBatch(t, store, statsFixture())

	points, err := store.Timeseries(context.Background(), Query{}, 2000)
	if err != nil {
		t.Fatalf("timeseries: %v", err)
	}
	if len(points) != 3 {
		t.Fatalf("points = %d, want 3", len(points))
	}
	expect := []struct {
		bucket   int64
		requests int64
		failed   int64
	}{
		{0, 1, 0},
		{2000, 2, 1},
		{4000, 2, 0},
	}
	for i, p := range points {
		if p.BucketMS != expect[i].bucket || p.Requests != expect[i].requests || p.Failed != expect[i].failed {
			t.Errorf("point[%d] = (%d, %d, %d), want (%d, %d, %d)",
				i, p.BucketMS, p.Requests, p.Failed, expect[i].bucket, expect[i].requests, expect[i].failed)
		}
	}
	// Last bucket aggregates 300 output tokens over 3.5 seconds.
	wantTPS := 310 / 3.5
	if diff := points[2].TPSAvg - wantTPS; diff > 0.01 || diff < -0.01 {
		t.Errorf("last bucket tps = %f, want %f", points[2].TPSAvg, wantTPS)
	}
}

func TestBreakdown(t *testing.T) {
	store := newTestStore(t)
	mustInsertBatch(t, store, statsFixture())

	rows, err := store.Breakdown(context.Background(), Query{}, "provider", 10)
	if err != nil {
		t.Fatalf("breakdown: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	// Ordered by request count desc: openai (3) then anthropic (2).
	if rows[0].Key != "openai" || rows[0].Requests != 3 || rows[0].Failed != 0 {
		t.Errorf("rows[0] = %+v, want openai/3/0", rows[0])
	}
	if rows[1].Key != "anthropic" || rows[1].Requests != 2 || rows[1].Failed != 1 {
		t.Errorf("rows[1] = %+v, want anthropic/2/1", rows[1])
	}

	if _, err = store.Breakdown(context.Background(), Query{}, "bogus", 10); err == nil {
		t.Fatal("unknown dimension should error")
	}
}

func TestBreakdownResponseModel(t *testing.T) {
	store := newTestStore(t)
	entries := []Entry{
		{
			RequestedAtMS: 1000,
			Model:         "gpt-4o",
			ResponseModel: "gpt-4o-2024-08-06",
			InputTokens:   1000,
			OutputTokens:  500,
		},
		{
			RequestedAtMS: 2000,
			Model:         "gpt-4o",
			ResponseModel: "gpt-4o-2024-08-06",
			InputTokens:   2000,
			OutputTokens:  1000,
		},
		{
			RequestedAtMS: 3000,
			Model:         "claude-3-5-sonnet",
			ResponseModel: "", // Fallback to Model when response_model is empty
			InputTokens:   500,
			OutputTokens:  200,
		},
	}
	mustInsertBatch(t, store, entries)

	rows, err := store.Breakdown(context.Background(), Query{}, "model", 10)
	if err != nil {
		t.Fatalf("breakdown: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	if rows[0].Key != "gpt-4o-2024-08-06" || rows[0].Requests != 2 {
		t.Errorf("rows[0] = %+v, want gpt-4o-2024-08-06 with 2 requests", rows[0])
	}
	if rows[1].Key != "claude-3-5-sonnet" || rows[1].Requests != 1 {
		t.Errorf("rows[1] = %+v, want claude-3-5-sonnet with 1 request", rows[1])
	}

	st, err := store.Stats(context.Background(), Query{})
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if st.UniqueModels != 2 {
		t.Errorf("st.UniqueModels = %d, want 2", st.UniqueModels)
	}
}

func TestTailBacklogAndKeyset(t *testing.T) {
	store := newTestStore(t)
	mustInsertBatch(t, store, statsFixture())

	backlog, err := store.TailBacklog(context.Background(), Query{}, 3)
	if err != nil {
		t.Fatalf("tail backlog: %v", err)
	}
	if len(backlog) != 3 {
		t.Fatalf("backlog = %d, want 3", len(backlog))
	}
	for i, want := range []int64{3, 4, 5} {
		if backlog[i].ID != want {
			t.Errorf("backlog[%d].id = %d, want %d (oldest first)", i, backlog[i].ID, want)
		}
	}

	older, err := store.Query(context.Background(), Query{BeforeID: 3})
	if err != nil {
		t.Fatalf("keyset query: %v", err)
	}
	if len(older) != 2 || older[0].ID != 2 || older[1].ID != 1 {
		t.Errorf("keyset = %d entries, want ids [2 1]", len(older))
	}

	byTrace, err := store.Query(context.Background(), Query{TraceID: "t1"})
	if err != nil {
		t.Fatalf("trace query: %v", err)
	}
	if len(byTrace) != 2 {
		t.Errorf("trace t1 = %d entries, want 2", len(byTrace))
	}
}

func TestStreamHub(t *testing.T) {
	filtered := SubscribeStream(Query{Model: "A"})
	slow := SubscribeStream(Query{})

	// Fill the slow subscriber's buffer; the filtered one must stay empty.
	for i := 0; i < streamSubscriberBuffer; i++ {
		publishStreamEntry(&Entry{ID: int64(i + 1), Model: "B"})
	}
	select {
	case <-filtered.Channel():
		t.Fatal("filtered subscriber must not receive other models")
	default:
	}

	// One more publish drops and closes the slow subscriber.
	publishStreamEntry(&Entry{ID: 9999, Model: "B"})
	for {
		_, ok := <-slow.Channel()
		if !ok {
			break
		}
	}

	// The filtered subscriber is unaffected and receives a matching entry.
	publishStreamEntry(&Entry{ID: 10_000, Model: "A"})
	select {
	case got := <-filtered.Channel():
		if got.ID != 10_000 {
			t.Fatalf("got id %d, want 10000", got.ID)
		}
	default:
		t.Fatal("filtered subscriber should have received the matching entry")
	}

	UnsubscribeStream(filtered)
	UnsubscribeStream(slow) // already removed by the drop path; must not panic
	if streamSubscriberCount() != 0 {
		t.Fatalf("subscribers = %d, want 0", streamSubscriberCount())
	}
}

func TestHandleUsagePublishesLive(t *testing.T) {
	sub := SubscribeStream(Query{})
	defer UnsubscribeStream(sub)

	plugin := &usageRecordPlugin{}
	plugin.HandleUsage(context.Background(), coreusage.Record{
		RequestID: "req-1",
		Model:     "gpt-4o",
		Provider:  "openai",
		Latency:   1500 * time.Millisecond,
	})

	select {
	case got := <-sub.Channel():
		if got.Model != "gpt-4o" || got.Provider != "openai" || got.LatencyMS != 1500 {
			t.Fatalf("live entry = (%s, %s, %d)", got.Model, got.Provider, got.LatencyMS)
		}
	default:
		t.Fatal("live subscriber should have received the usage record")
	}
}
