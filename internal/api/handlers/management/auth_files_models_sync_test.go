package management

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

func TestSyncAuthFileModels_MissingName(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{AuthDir: t.TempDir()}
	manager := coreauth.NewManager(nil, nil, nil)
	h := NewHandlerWithoutConfigFilePath(cfg, manager)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v8/management/credentials/models/sync", strings.NewReader(`{}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.SyncAuthFileModels(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing name, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSyncAuthFileModels_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{AuthDir: t.TempDir()}
	manager := coreauth.NewManager(nil, nil, nil)
	h := NewHandlerWithoutConfigFilePath(cfg, manager)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v8/management/credentials/models/sync", strings.NewReader(`{"name":"nonexistent.json"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.SyncAuthFileModels(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for nonexistent file, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSyncAuthFileModels_SuccessWithCatalogFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	authDir := t.TempDir()
	cfg := &config.Config{AuthDir: authDir}
	manager := coreauth.NewManager(nil, nil, nil)
	h := NewHandlerWithoutConfigFilePath(cfg, manager)

	testAuth := &coreauth.Auth{
		ID:       "codex-test-1",
		FileName: "codex-test.json",
		Provider: "codex",
		Status:   coreauth.StatusActive,
		Attributes: map[string]string{
			"plan_type": "pro",
		},
	}
	if _, err := manager.Register(context.Background(), testAuth); err != nil {
		t.Fatalf("failed to register auth: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v8/management/credentials/models/sync", strings.NewReader(`{"name":"codex-test.json"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.SyncAuthFileModels(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		OK       bool             `json:"ok"`
		Models   []map[string]any `json:"models"`
		Count    int              `json:"count"`
		Cached   bool             `json:"cached"`
		SyncedAt string           `json:"synced_at"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}

	if !resp.OK || resp.Count == 0 || len(resp.Models) == 0 {
		t.Fatalf("expected models in response, got count=%d, models=%d", resp.Count, len(resp.Models))
	}
	if !resp.Cached || resp.SyncedAt == "" {
		t.Fatalf("expected cached=true and valid synced_at, got cached=%v, synced_at=%s", resp.Cached, resp.SyncedAt)
	}

	// Verify cached_models was persisted into metadata
	reloaded, ok := manager.GetByID(testAuth.ID)
	if !ok || reloaded == nil {
		t.Fatal("expected auth to be found in manager")
	}
	if reloaded.Metadata == nil || reloaded.Metadata["cached_models"] == nil {
		t.Fatalf("expected cached_models in auth metadata, got: %#v", reloaded.Metadata)
	}

	// Verify GetAuthFileModels reads the cached models
	wGet := httptest.NewRecorder()
	cGet, _ := gin.CreateTestContext(wGet)
	cGet.Request = httptest.NewRequest(http.MethodGet, "/v8/management/credentials/models?name=codex-test.json", nil)
	h.GetAuthFileModels(cGet)

	if wGet.Code != http.StatusOK {
		t.Fatalf("expected 200 from GetAuthFileModels, got %d: %s", wGet.Code, wGet.Body.String())
	}

	var getResp struct {
		Models []map[string]any `json:"models"`
	}
	if err := json.Unmarshal(wGet.Body.Bytes(), &getResp); err != nil {
		t.Fatalf("unmarshal GetAuthFileModels response: %v", err)
	}
	if len(getResp.Models) == 0 {
		t.Fatalf("expected non-empty models from GetAuthFileModels, got %d", len(getResp.Models))
	}
}

func TestSyncAuthFileModels_AntigravityUpstreamServer(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Mock upstream Google PA server
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1internal:fetchAvailableModels" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-access-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"models": {
				"gemini-2.5-pro": {
					"displayName": "Gemini 2.5 Pro"
				},
				"claude-3-7-sonnet": {
					"displayName": "Claude 3.7 Sonnet"
				}
			}
		}`))
	}))
	defer upstreamServer.Close()

	authDir := t.TempDir()
	filePath := filepath.Join(authDir, "antigravity-account.json")
	_ = os.WriteFile(filePath, []byte(`{"type":"antigravity","email":"test@example.com"}`), 0600)

	cfg := &config.Config{AuthDir: authDir}
	manager := coreauth.NewManager(nil, nil, nil)
	h := NewHandlerWithoutConfigFilePath(cfg, manager)

	agAuth := &coreauth.Auth{
		ID:       "ag-auth-1",
		FileName: "antigravity-account.json",
		Provider: "antigravity",
		Status:   coreauth.StatusActive,
		Attributes: map[string]string{
			"base_url": upstreamServer.URL,
		},
		Metadata: map[string]any{
			"access_token": "test-access-token",
		},
	}
	if _, err := manager.Register(context.Background(), agAuth); err != nil {
		t.Fatalf("failed to register auth: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v8/management/credentials/models/sync", strings.NewReader(`{"name":"antigravity-account.json"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.SyncAuthFileModels(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		OK     bool             `json:"ok"`
		Models []map[string]any `json:"models"`
		Count  int              `json:"count"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if resp.Count != 2 || len(resp.Models) != 2 {
		t.Fatalf("expected 2 synced models, got count=%d, len=%d", resp.Count, len(resp.Models))
	}
	ids := []string{resp.Models[0]["id"].(string), resp.Models[1]["id"].(string)}
	if ids[0] != "claude-3-7-sonnet" || ids[1] != "gemini-2.5-pro" {
		t.Fatalf("expected [claude-3-7-sonnet gemini-2.5-pro], got %v", ids)
	}
}

func TestSyncAuthFileModels_PeerCredentialsPropagation(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cfg := &config.Config{}
	manager := coreauth.NewManager(nil, nil, nil)
	h := NewHandler(cfg, "", manager)

	// Peer 1: codex free
	p1 := &coreauth.Auth{
		ID:       "codex-peer-1",
		FileName: "codex-free-1.json",
		Provider: "codex",
		Status:   coreauth.StatusActive,
		Attributes: map[string]string{
			"plan_type": "free",
		},
	}
	// Peer 2: another codex free
	p2 := &coreauth.Auth{
		ID:       "codex-peer-2",
		FileName: "codex-free-2.json",
		Provider: "codex",
		Status:   coreauth.StatusActive,
		Attributes: map[string]string{
			"plan_type": "free",
		},
	}
	// Different tier: codex plus
	pPlus := &coreauth.Auth{
		ID:       "codex-peer-plus",
		FileName: "codex-plus.json",
		Provider: "codex",
		Status:   coreauth.StatusActive,
		Attributes: map[string]string{
			"plan_type": "plus",
		},
	}
	// Different provider: claude
	pClaude := &coreauth.Auth{
		ID:       "claude-peer",
		FileName: "claude.json",
		Provider: "claude",
		Status:   coreauth.StatusActive,
	}

	for _, a := range []*coreauth.Auth{p1, p2, pPlus, pClaude} {
		if _, err := manager.Register(context.Background(), a); err != nil {
			t.Fatalf("failed to register auth: %v", err)
		}
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v8/management/credentials/models/sync", strings.NewReader(`{"name":"codex-free-1.json"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.SyncAuthFileModels(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		OK          bool             `json:"ok"`
		Models      []map[string]any `json:"models"`
		Count       int              `json:"count"`
		SyncedPeers int              `json:"synced_peers"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.SyncedPeers != 1 {
		t.Fatalf("expected 1 synced peer, got %d", resp.SyncedPeers)
	}

	// Verify p2 got updated metadata
	reloadedP2, ok := manager.GetByID(p2.ID)
	if !ok || reloadedP2 == nil || reloadedP2.Metadata == nil || reloadedP2.Metadata["cached_models"] == nil {
		t.Fatalf("expected p2 to have cached_models metadata populated, got %#v", reloadedP2)
	}

	// Verify pPlus did NOT get updated
	reloadedPlus, ok := manager.GetByID(pPlus.ID)
	if !ok || reloadedPlus == nil || (reloadedPlus.Metadata != nil && reloadedPlus.Metadata["cached_models"] != nil) {
		t.Fatalf("expected pPlus to NOT have cached_models, got %#v", reloadedPlus.Metadata)
	}

	// Verify pClaude did NOT get updated
	reloadedClaude, ok := manager.GetByID(pClaude.ID)
	if !ok || reloadedClaude == nil || (reloadedClaude.Metadata != nil && reloadedClaude.Metadata["cached_models"] != nil) {
		t.Fatalf("expected pClaude to NOT have cached_models, got %#v", reloadedClaude.Metadata)
	}
}
