package requestdb

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

func openTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "requestlog.db")
	store, err := Open(path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() {
		if errClose := store.Close(); errClose != nil {
			t.Fatalf("Close() error = %v", errClose)
		}
	})
	return store, path
}

func sampleEntry(requestID string, requestedAtMS int64) Entry {
	return Entry{
		RequestedAtMS:            requestedAtMS,
		RequestID:                requestID,
		TraceID:                  "trace-1",
		Endpoint:                 "POST /v1/chat/completions",
		ClientIP:                 "127.0.0.1",
		UserAgent:                "test-agent",
		SessionID:                "session-1",
		APIKey:                   "key-1",
		IsNativeKey:              true,
		Provider:                 "codex",
		ExecutorType:             "codex",
		AuthID:                   "auth-1",
		Model:                    "gpt-test",
		Alias:                    "gpt-test-alias",
		ResponseModel:            "gpt-test-upstream",
		ReasoningEffort:          "high",
		RequestedReasoningEffort: "xhigh",
		ServiceTier:              "auto",
		Generate:                 true,
		Stream:                   true,
		Failed:                   false,
		StatusCode:               200,
		LatencyMS:                123,
		TTFTMS:                   45,
		InputTokens:              100,
		OutputTokens:             50,
		ReasoningTokens:          20,
		CachedTokens:             10,
		CacheReadTokens:          8,
		CacheCreationTokens:      2,
		TotalTokens:              150,
		TokenBreakdown:           []byte(`{"input":{"total":100}}`),
		RequestHeaders:           []byte(`{"Authorization":["Bearer ***"]}`),
		ResponseHeaders:          []byte(`{"Content-Type":["application/json"]}`),
	}
}

func TestStoreMigrateIsIdempotent(t *testing.T) {
	_, path := openTestStore(t)
	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("re-Open() on migrated database error = %v", err)
	}
	if errClose := reopened.Close(); errClose != nil {
		t.Fatalf("re-Open Close() error = %v", errClose)
	}
}

func TestStoreInsertBatchAndQueryRoundtrip(t *testing.T) {
	store, _ := openTestStore(t)
	ctx := context.Background()

	entries := []Entry{
		sampleEntry("req-1", 1000),
		sampleEntry("req-2", 2000),
		sampleEntry("req-3", 3000),
	}
	entries[2].Failed = true
	entries[2].StatusCode = 502
	if err := store.InsertBatch(ctx, entries); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	total, err := store.Count(ctx, Query{})
	if err != nil {
		t.Fatalf("Count() error = %v", err)
	}
	if total != 3 {
		t.Fatalf("Count() = %d, want 3", total)
	}

	got, err := store.Query(ctx, Query{Limit: 10, Offset: 0})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("Query() returned %d entries, want 3", len(got))
	}
	// Newest first.
	if got[0].RequestID != "req-3" || got[2].RequestID != "req-1" {
		t.Fatalf("Query() order = [%s, %s, %s], want newest first", got[0].RequestID, got[1].RequestID, got[2].RequestID)
	}
	if got[0].RequestedAtMS != 3000 {
		t.Fatalf("RequestedAtMS = %d, want 3000", got[0].RequestedAtMS)
	}
	if !got[0].Stream || !got[0].IsNativeKey || got[0].RequestedReasoningEffort != "xhigh" {
		t.Fatalf("Query() roundtrip lost scalar fields: %+v", got[0])
	}
	if got[0].TokenBreakdown != nil || got[0].RequestHeaders != nil {
		t.Fatalf("list query should not return blob columns, got %+v", got[0])
	}
}

func TestStoreQueryFilters(t *testing.T) {
	store, _ := openTestStore(t)
	ctx := context.Background()

	entries := []Entry{
		sampleEntry("req-1", 1000),
		sampleEntry("req-2", 2000),
		sampleEntry("req-3", 3000),
	}
	entries[1].Model = "other-model"
	entries[1].Provider = "claude"
	entries[2].Model = "third-model"
	entries[2].Provider = "gemini"
	entries[2].Failed = true
	entries[2].StatusCode = 502
	if err := store.InsertBatch(ctx, entries); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	cases := []struct {
		name    string
		query   Query
		wantIDs []string
	}{
		{"model", Query{Model: "gpt-test", Limit: 10}, []string{"req-1"}},
		{"model-substring", Query{Model: "pt-tes", Limit: 10}, []string{"req-1"}},
		{"model-substring-no-match", Query{Model: "claude-opus", Limit: 10}, nil},
		{"provider", Query{Provider: "claude", Limit: 10}, []string{"req-2"}},
		{"failed", Query{Failed: boolPtr(true), Limit: 10}, []string{"req-3"}},
		{"not-failed", Query{Failed: boolPtr(false), Limit: 10}, []string{"req-2", "req-1"}},
		{"status", Query{StatusCode: 502, Limit: 10}, []string{"req-3"}},
		{"time-range", Query{FromMS: 1500, ToMS: 2500, Limit: 10}, []string{"req-2"}},
		{"request-id", Query{RequestID: "req-1", Limit: 10}, []string{"req-1"}},
		{"request-id-substring", Query{RequestID: "eq-2", Limit: 10}, []string{"req-2"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := store.Query(ctx, tc.query)
			if err != nil {
				t.Fatalf("Query() error = %v", err)
			}
			if len(got) != len(tc.wantIDs) {
				t.Fatalf("Query() matched %d entries, want %d (%v)", len(got), len(tc.wantIDs), tc.wantIDs)
			}
			for i, want := range tc.wantIDs {
				if got[i].RequestID != want {
					t.Fatalf("Query() result[%d] = %s, want %s", i, got[i].RequestID, want)
				}
			}
		})
	}
}

func TestStoreQueryFiltersEscapeLikeWildcards(t *testing.T) {
	store, _ := openTestStore(t)
	ctx := context.Background()

	entries := []Entry{
		sampleEntry("req-1", 1000),
		sampleEntry("req-2", 2000),
	}
	entries[0].Model = "model_100%"
	entries[1].Model = "modelX100Y"
	if err := store.InsertBatch(ctx, entries); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	// An underscore in the input must match literally, not as a single-char wildcard.
	got, err := store.Query(ctx, Query{Model: "model_100", Limit: 10})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if len(got) != 1 || got[0].RequestID != "req-1" {
		t.Fatalf("Query(model_100) matched %v, want only req-1", requestIDs(got))
	}

	// A percent sign must match literally instead of any suffix.
	got, err = store.Query(ctx, Query{Model: "100%", Limit: 10})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if len(got) != 1 || got[0].RequestID != "req-1" {
		t.Fatalf("Query(100%%) matched %v, want only req-1", requestIDs(got))
	}
}

func requestIDs(entries []Entry) []string {
	ids := make([]string, 0, len(entries))
	for i := range entries {
		ids = append(ids, entries[i].RequestID)
	}
	return ids
}

func TestStoreGetByIDDecompressesBlobs(t *testing.T) {
	store, _ := openTestStore(t)
	ctx := context.Background()

	entry := sampleEntry("req-1", 1000)
	compressed := []Entry{entry}
	// Simulate the writer pipeline: blobs are stored compressed.
	for i := range compressed {
		compressed[i].TokenBreakdown = compressBlob(entry.TokenBreakdown)
		compressed[i].RequestHeaders = compressBlob(entry.RequestHeaders)
		compressed[i].ResponseHeaders = compressBlob(entry.ResponseHeaders)
		compressed[i].ErrorBody = compressBlob([]byte("upstream exploded"))
	}
	if err := store.InsertBatch(ctx, compressed); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	got, err := store.Query(ctx, Query{Limit: 1})
	if err != nil || len(got) != 1 {
		t.Fatalf("Query() = %d entries, error %v", len(got), err)
	}

	detail, err := store.GetByID(ctx, got[0].ID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if detail == nil {
		t.Fatal("GetByID() = nil, want entry")
	}
	if detail.RequestID != "req-1" {
		t.Fatalf("RequestID = %q, want req-1", detail.RequestID)
	}
	var breakdown map[string]any
	if err := json.Unmarshal(detail.TokenBreakdown, &breakdown); err != nil {
		t.Fatalf("token breakdown blob is not valid JSON: %v", err)
	}
	var headers map[string][]string
	if err := json.Unmarshal(detail.RequestHeaders, &headers); err != nil {
		t.Fatalf("request headers blob is not valid JSON: %v", err)
	}
	if headers["Authorization"] == nil || headers["Authorization"][0] != "Bearer ***" {
		t.Fatalf("request headers roundtrip mismatch: %v", headers)
	}
	if string(detail.ErrorBody) != "upstream exploded" {
		t.Fatalf("ErrorBody = %q, want upstream exploded", detail.ErrorBody)
	}

	missing, err := store.GetByID(ctx, 99999)
	if err != nil || missing != nil {
		t.Fatalf("GetByID(missing) = %v, %v; want nil, nil", missing, err)
	}
}

func TestStoreDeleteBefore(t *testing.T) {
	store, _ := openTestStore(t)
	ctx := context.Background()

	entries := []Entry{
		sampleEntry("old-1", 100),
		sampleEntry("old-2", 200),
		sampleEntry("new-1", 9000),
	}
	if err := store.InsertBatch(ctx, entries); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	deleted, err := store.DeleteBefore(ctx, 1000)
	if err != nil {
		t.Fatalf("DeleteBefore() error = %v", err)
	}
	if deleted != 2 {
		t.Fatalf("DeleteBefore() deleted %d rows, want 2", deleted)
	}
	total, err := store.Count(ctx, Query{})
	if err != nil {
		t.Fatalf("Count() error = %v", err)
	}
	if total != 1 {
		t.Fatalf("Count() after retention = %d, want 1", total)
	}
}

func boolPtr(v bool) *bool {
	return &v
}
