package management

import (
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

func TestModelQuotaObservationPayloadOmitsUnsupportedProviders(t *testing.T) {
	states := map[string]*coreauth.ModelState{
		"grok-4": {
			Quota: coreauth.QuotaState{
				ObservedAt: time.Unix(10, 0),
				Signals:    map[string]string{"X-Ratelimit-Remaining-Requests": "1"},
			},
		},
	}
	if got := modelQuotaObservationPayload("grok", states); len(got) != 0 {
		t.Fatalf("unsupported provider returned model observations: %#v", got)
	}
	for _, provider := range []string{"gemini", "gemini-interactions", "openai", "openai-compatibility", "plugin-provider"} {
		if got := modelQuotaObservationPayload(provider, states); len(got) != 0 {
			t.Fatalf("provider %q returned model observations: %#v", provider, got)
		}
	}
}

func TestModelQuotaObservationPayloadSkipsNilAndEmptyStates(t *testing.T) {
	states := map[string]*coreauth.ModelState{
		"nil":   nil,
		"empty": &coreauth.ModelState{},
		"observed": &coreauth.ModelState{Quota: coreauth.QuotaState{
			ObservedAt: time.Unix(10, 0),
			Signals:    map[string]string{"X-Codex-Plan-Type": "pro"},
		}},
	}
	got := modelQuotaObservationPayload("codex", states)
	if len(got) != 1 {
		t.Fatalf("model observations = %#v, want only observed state", got)
	}
	if _, ok := got["observed"]; !ok {
		t.Fatalf("observed model quota missing: %#v", got)
	}
}

func TestQuotaObservationPayloadExcludesCooldownState(t *testing.T) {
	payload := quotaObservationPayload(coreauth.QuotaState{
		Exceeded:      true,
		Reason:        "credential_quota",
		NextRecoverAt: time.Unix(20, 0),
		BackoffLevel:  3,
		ObservedAt:    time.Unix(10, 0),
		Signals:       map[string]string{"X-Codex-Plan-Type": "pro"},
	})
	if _, ok := payload["exceeded"]; ok {
		t.Fatalf("cooldown exceeded leaked: %#v", payload)
	}
	if _, ok := payload["reason"]; ok {
		t.Fatalf("cooldown reason leaked: %#v", payload)
	}
	if _, ok := payload["next_recover_at"]; ok {
		t.Fatalf("cooldown recovery leaked: %#v", payload)
	}
	if _, ok := payload["backoff_level"]; ok {
		t.Fatalf("cooldown backoff leaked: %#v", payload)
	}
}

func TestBuildAuthFileEntry_ManualQuotaSnapshot(t *testing.T) {
	h := NewHandler(nil, "", nil)
	auth := &coreauth.Auth{
		ID:       "auth-test-1",
		Provider: "codex",
		FileName: "test.json",
		Success:  10,
		Failed:   2,
		Attributes: map[string]string{
			"path": "/tmp/test.json",
		},
	}
	auth.EnsureIndex()

	// Before recording manual quota, manual_quota must be nil
	entryBefore := h.buildAuthFileEntryLocked(auth, authFileQuotaContext{})
	if _, ok := entryBefore["manual_quota"]; ok {
		t.Fatalf("expected manual_quota to be omitted before fetch, got: %#v", entryBefore["manual_quota"])
	}

	// Record manual quota
	quotaData := map[string]any{"plan": "pro", "remaining_percent": 80.0}
	h.recordManualQuota(auth, quotaData)

	entryAfter := h.buildAuthFileEntryLocked(auth, authFileQuotaContext{})
	rawMq, ok := entryAfter["manual_quota"]
	if !ok || rawMq == nil {
		t.Fatalf("expected manual_quota to be present after record, got nil")
	}
	mq, okMq := rawMq.(gin.H)
	if !okMq {
		t.Fatalf("manual_quota is not gin.H: %#v", rawMq)
	}
	if mq["base_success"] != int64(10) || mq["base_failed"] != int64(2) {
		t.Fatalf("unexpected base counters: success=%v, failed=%v", mq["base_success"], mq["base_failed"])
	}
	if mq["data"] == nil {
		t.Fatalf("manual_quota data is nil")
	}
}
