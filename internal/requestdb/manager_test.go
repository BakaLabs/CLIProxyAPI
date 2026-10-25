package requestdb

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

func testOptions(dir string, modify func(*Options)) Options {
	opts := Options{
		Enabled:           true,
		Path:              filepath.Join(dir, "requestlog.db"),
		RetentionDays:     30,
		PreviewBytes:      0,
		ErrorBodyMaxBytes: 8192,
	}
	if modify != nil {
		modify(&opts)
	}
	return opts
}

func TestSetConfigLifecyclePersistsUsageRecords(t *testing.T) {
	t.Cleanup(Shutdown)
	dir := t.TempDir()
	// Retention disabled: the record uses a fixed 1970 timestamp that a
	// retention sweep would otherwise delete non-deterministically.
	opts := testOptions(dir, func(o *Options) { o.RetentionDays = 0 })

	SetConfig(opts)
	if !enabled() {
		t.Fatal("manager not active after SetConfig(enabled)")
	}

	plugin := &usageRecordPlugin{}
	plugin.HandleUsage(coreusage.WithReasoningEffort(context.Background(), "high"), coreusage.Record{
		RequestID:       "exec-1",
		Provider:        "codex",
		Model:           "gpt-test",
		Alias:           "gpt-alias",
		ReasoningEffort: "high",
		RequestedAt:     time.UnixMilli(1000),
		Detail:          coreusage.Detail{InputTokens: 10, OutputTokens: 5, TotalTokens: 15},
	})

	// Shutdown flushes the writer buffer; reopening the same file must show
	// the record without any polling or sleeps.
	Shutdown()
	if enabled() {
		t.Fatal("manager still active after Shutdown")
	}

	SetConfig(testOptions(dir, func(o *Options) { o.RetentionDays = 0 }))
	defer Shutdown()
	entries, total, err := QueryEntries(context.Background(), Query{Limit: 10})
	if err != nil {
		t.Fatalf("QueryEntries() error = %v", err)
	}
	if total != 1 || len(entries) != 1 {
		t.Fatalf("QueryEntries() = %d entries (total %d), want 1", len(entries), total)
	}
	if entries[0].RequestID != "exec-1" || entries[0].Model != "gpt-test" {
		t.Fatalf("stored entry mismatch: %+v", entries[0])
	}
	if entries[0].RequestedReasoningEffort != "high" || entries[0].ReasoningEffort != "high" {
		t.Fatalf("effort mismatch: requested=%q translated=%q", entries[0].RequestedReasoningEffort, entries[0].ReasoningEffort)
	}
}

func TestSetConfigDisableRejectsQueries(t *testing.T) {
	t.Cleanup(Shutdown)
	dir := t.TempDir()
	SetConfig(testOptions(dir, nil))
	SetConfig(Options{Enabled: false})

	if _, _, err := QueryEntries(context.Background(), Query{Limit: 10}); !errors.Is(err, ErrDisabled) {
		t.Fatalf("QueryEntries() error = %v, want ErrDisabled", err)
	}
	if _, err := GetEntryDetail(context.Background(), 1); !errors.Is(err, ErrDisabled) {
		t.Fatalf("GetEntryDetail() error = %v, want ErrDisabled", err)
	}
}

func TestPreviewBytesGate(t *testing.T) {
	t.Cleanup(Shutdown)
	dir := t.TempDir()

	SetConfig(testOptions(dir, func(o *Options) { o.PreviewBytes = 128 }))
	if got := PreviewBytes(); got != 128 {
		t.Fatalf("PreviewBytes() = %d, want 128", got)
	}

	SetConfig(Options{Enabled: false})
	if got := PreviewBytes(); got != 0 {
		t.Fatalf("PreviewBytes() when disabled = %d, want 0", got)
	}
}

func TestRetentionSweepsExpiredEntriesOnOpen(t *testing.T) {
	t.Cleanup(Shutdown)
	dir := t.TempDir()
	opts := testOptions(dir, nil)

	// Seed an expired entry directly, then let the initial retention sweep of a
	// fresh manager remove it.
	SetConfig(opts)
	plugin := &usageRecordPlugin{}
	expired := time.Now().Add(-40 * 24 * time.Hour)
	plugin.HandleUsage(context.Background(), coreusage.Record{
		RequestID:   "expired",
		RequestedAt: expired,
	})
	plugin.HandleUsage(context.Background(), coreusage.Record{
		RequestID:   "fresh",
		RequestedAt: time.Now(),
	})
	Shutdown()

	SetConfig(testOptions(dir, func(o *Options) { o.RetentionDays = 30 }))
	// Shutdown waits for the initial retention sweep, so the result is
	// deterministic once the store is reopened.
	Shutdown()

	SetConfig(testOptions(dir, nil))
	defer Shutdown()

	entries, total, err := QueryEntries(context.Background(), Query{Limit: 10})
	if err != nil {
		t.Fatalf("QueryEntries() error = %v", err)
	}
	if total != 1 || len(entries) != 1 {
		t.Fatalf("QueryEntries() = %d entries (total %d), want only the fresh one", len(entries), total)
	}
	if entries[0].RequestID != "fresh" {
		t.Fatalf("surviving entry = %q, want fresh", entries[0].RequestID)
	}
}

func TestActiveManagerPublishesLiveStreamWithRealID(t *testing.T) {
	t.Cleanup(Shutdown)
	dir := t.TempDir()
	opts := testOptions(dir, func(o *Options) { o.RetentionDays = 0 })
	SetConfig(opts)
	defer Shutdown()

	sub := SubscribeStream(Query{})
	defer UnsubscribeStream(sub)

	plugin := &usageRecordPlugin{}
	plugin.HandleUsage(context.Background(), coreusage.Record{
		RequestID:   "exec-live-1",
		Provider:    "codex",
		Model:       "gpt-test",
		RequestedAt: time.Now(),
		Detail:      coreusage.Detail{InputTokens: 10, OutputTokens: 5, TotalTokens: 15},
	})

	select {
	case got := <-sub.Channel():
		if got.ID <= 0 {
			t.Fatalf("live entry ID = %d, want > 0", got.ID)
		}
		if got.RequestID != "exec-live-1" {
			t.Fatalf("live entry RequestID = %s, want exec-live-1", got.RequestID)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for live stream record")
	}
}
