package management

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/clienterror"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	log "github.com/sirupsen/logrus"
	"github.com/tidwall/gjson"
)

// SyncAuthFileModels actively queries upstream for the latest models supported
// by this credential, stores the models in memory/metadata cache, updates the
// global registry, and returns the models.
func (h *Handler) SyncAuthFileModels(c *gin.Context) {
	if h.authManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "core auth manager unavailable"})
		return
	}

	var req struct {
		Name      string `json:"name"`
		AuthIndex string `json:"auth_index"`
	}
	if c.Request.Body != nil && c.Request.ContentLength != 0 {
		if errBind := c.ShouldBindJSON(&req); errBind != nil && !errors.Is(errBind, io.EOF) {
			c.JSON(clienterror.HTTPStatusFromErrorOr(errBind, http.StatusBadRequest), gin.H{"error": "invalid request body: " + errBind.Error()})
			return
		}
	}
	if qName := strings.TrimSpace(c.Query("name")); qName != "" && req.Name == "" {
		req.Name = qName
	}
	if qIndex := strings.TrimSpace(c.Query("auth_index")); qIndex != "" && req.AuthIndex == "" {
		req.AuthIndex = qIndex
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	targetAuth, ok := h.lookupAuthFile(name, req.AuthIndex)
	if !ok || targetAuth == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "auth file not found"})
		return
	}

	ctx := c.Request.Context()
	models, errFetch := h.fetchUpstreamModelsForAuth(ctx, targetAuth)
	if errFetch != nil {
		log.WithError(errFetch).Warnf("failed to sync upstream models for %s", targetAuth.ID)
		c.JSON(http.StatusBadGateway, gin.H{
			"error": fmt.Sprintf("failed to sync upstream models: %v", errFetch),
		})
		return
	}

	// Record in memory cache
	h.recordCachedModels(targetAuth, models)

	// Register in global registry
	reg := registry.GetGlobalRegistry()
	if reg != nil && targetAuth.ID != "" && targetAuth.Provider != "" && len(models) > 0 {
		reg.RegisterClient(targetAuth.ID, targetAuth.Provider, models)
	}

	// Persist into auth file metadata
	modelIDs := make([]string, 0, len(models))
	for _, m := range models {
		if m != nil && strings.TrimSpace(m.ID) != "" {
			modelIDs = append(modelIDs, strings.TrimSpace(m.ID))
		}
	}
	syncedAt := time.Now().UTC().Format(time.RFC3339)
	_, _, _ = h.authManager.Modify(ctx, targetAuth.ID, targetAuth.RegistrationEpoch, func(current *coreauth.Auth) error {
		if current.Metadata == nil {
			current.Metadata = make(map[string]any)
		}
		current.Metadata["cached_models"] = modelIDs
		current.Metadata["cached_models_time"] = syncedAt
		return nil
	})

	// Broadcast model cache to other credentials with matching provider and plan/type
	var syncedPeers int
	if h.authManager != nil {
		for _, peer := range h.authManager.List() {
			if peer == nil || peer.ID == targetAuth.ID {
				continue
			}
			if isSameProviderAndType(targetAuth, peer) {
				h.recordCachedModels(peer, models)
				if reg != nil && peer.ID != "" && peer.Provider != "" && len(models) > 0 && !peer.Disabled && peer.Status != coreauth.StatusDisabled {
					reg.RegisterClient(peer.ID, peer.Provider, models)
				}
				_, _, _ = h.authManager.Modify(ctx, peer.ID, peer.RegistrationEpoch, func(current *coreauth.Auth) error {
					if current.Metadata == nil {
						current.Metadata = make(map[string]any)
					}
					current.Metadata["cached_models"] = modelIDs
					current.Metadata["cached_models_time"] = syncedAt
					return nil
				})
				syncedPeers++
			}
		}
	}

	result := make([]gin.H, 0, len(models))
	for _, m := range models {
		if m == nil || m.ID == "" {
			continue
		}
		entry := gin.H{"id": m.ID}
		if m.DisplayName != "" {
			entry["display_name"] = m.DisplayName
		}
		if m.Type != "" {
			entry["type"] = m.Type
		}
		if m.OwnedBy != "" {
			entry["owned_by"] = m.OwnedBy
		}
		result = append(result, entry)
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":           true,
		"models":       result,
		"count":        len(result),
		"cached":       true,
		"synced_at":    syncedAt,
		"synced_peers": syncedPeers,
	})
}

// resolveAuthPlanType extracts the normalized plan type (e.g. "free", "plus", "team") for an auth.
func resolveAuthPlanType(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if pt := strings.TrimSpace(authAttribute(auth, "plan_type")); pt != "" {
		return strings.ToLower(pt)
	}
	if auth.Metadata != nil {
		if ptRaw, ok := auth.Metadata["plan_type"].(string); ok && strings.TrimSpace(ptRaw) != "" {
			return strings.ToLower(strings.TrimSpace(ptRaw))
		}
	}
	if claims := extractCodexIDTokenClaims(auth); claims != nil {
		if pt, okPt := claims["plan_type"].(string); okPt && strings.TrimSpace(pt) != "" {
			return strings.ToLower(strings.TrimSpace(pt))
		}
	}
	if strings.EqualFold(strings.TrimSpace(auth.Provider), "codex") {
		return "free"
	}
	return ""
}

// isSameProviderAndType returns true if two credentials share the same provider,
// auth kind (e.g. oauth vs api-key), and plan type.
func isSameProviderAndType(a, b *coreauth.Auth) bool {
	if a == nil || b == nil {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(a.Provider), strings.TrimSpace(b.Provider)) {
		return false
	}
	if a.AuthKind() != b.AuthKind() {
		return false
	}
	if !strings.EqualFold(resolveAuthPlanType(a), resolveAuthPlanType(b)) {
		return false
	}
	return true
}

func (h *Handler) recordCachedModels(auth *coreauth.Auth, models []*registry.ModelInfo) {
	if h == nil || auth == nil || len(models) == 0 {
		return
	}
	h.cachedModelsMu.Lock()
	defer h.cachedModelsMu.Unlock()
	if h.cachedModels == nil {
		h.cachedModels = make(map[string][]*registry.ModelInfo)
	}
	if auth.ID != "" {
		h.cachedModels[auth.ID] = models
	}
	auth.EnsureIndex()
	if auth.Index != "" {
		h.cachedModels[auth.Index] = models
	}
	if auth.FileName != "" {
		h.cachedModels[auth.FileName] = models
	}
}

func (h *Handler) getCachedModels(idOrName string) []*registry.ModelInfo {
	if h == nil || idOrName == "" {
		return nil
	}
	h.cachedModelsMu.RLock()
	defer h.cachedModelsMu.RUnlock()
	if h.cachedModels == nil {
		return nil
	}
	if models, ok := h.cachedModels[idOrName]; ok && len(models) > 0 {
		return models
	}
	return nil
}

func parseCachedModelsMetadata(raw any) []*registry.ModelInfo {
	switch items := raw.(type) {
	case []any:
		result := make([]*registry.ModelInfo, 0, len(items))
		for _, item := range items {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				result = append(result, &registry.ModelInfo{ID: strings.TrimSpace(s)})
			} else if m, ok := item.(map[string]any); ok {
				if id, ok := m["id"].(string); ok && strings.TrimSpace(id) != "" {
					info := &registry.ModelInfo{ID: strings.TrimSpace(id)}
					if name, ok := m["display_name"].(string); ok {
						info.DisplayName = name
					}
					result = append(result, info)
				}
			}
		}
		return result
	case []string:
		result := make([]*registry.ModelInfo, 0, len(items))
		for _, item := range items {
			if strings.TrimSpace(item) != "" {
				result = append(result, &registry.ModelInfo{ID: strings.TrimSpace(item)})
			}
		}
		return result
	default:
		return nil
	}
}

// fetchUpstreamModelsForAuth retrieves models from the upstream API for a given credential.
func (h *Handler) fetchUpstreamModelsForAuth(ctx context.Context, auth *coreauth.Auth) ([]*registry.ModelInfo, error) {
	if auth == nil {
		return nil, errors.New("auth is nil")
	}

	provider := strings.ToLower(strings.TrimSpace(auth.Provider))
	switch provider {
	case "antigravity":
		return h.fetchAntigravityUpstreamModels(ctx, auth)
	case "codex":
		return h.fetchCodexUpstreamModels(ctx, auth)
	case "claude":
		return h.fetchClaudeUpstreamModels(ctx, auth)
	case "gemini", "aistudio":
		return h.fetchGeminiUpstreamModels(ctx, auth)
	case "openai", "openai-compatibility":
		return h.fetchOpenAICompatUpstreamModels(ctx, auth)
	case "xai", "grok", "x-ai":
		return h.fetchXAIUpstreamModels(ctx, auth)
	case "kimi", "kimi-ai", "kimi.ai", "kimi.com":
		return h.fetchKimiUpstreamModels(ctx, auth)
	case "devin":
		if models := registry.GetDevinModels(); len(models) > 0 {
			return models, nil
		}
	case "meta", "muse":
		if models := registry.GetMetaModels(); len(models) > 0 {
			return models, nil
		}
	}

	// Try plugin host if available
	h.mu.Lock()
	host := h.pluginHost
	h.mu.Unlock()
	if host != nil {
		if models := host.ModelsForProvider(auth.Provider); len(models) > 0 {
			return models, nil
		}
	}

	// Fallback to static catalog or config compatibility
	if staticModels := registry.GetStaticModelDefinitionsByChannel(auth.Provider); len(staticModels) > 0 {
		return staticModels, nil
	}

	if h.cfg != nil {
		for _, compat := range h.cfg.OpenAICompatibility {
			if strings.EqualFold(compat.Name, auth.Provider) && len(compat.Models) > 0 {
				var models []*registry.ModelInfo
				for _, m := range compat.Models {
					models = append(models, &registry.ModelInfo{ID: m.Name, DisplayName: m.Alias})
				}
				return models, nil
			}
		}
	}

	return nil, fmt.Errorf("no upstream model provider available for %s", auth.Provider)
}

func (h *Handler) fetchAntigravityUpstreamModels(ctx context.Context, auth *coreauth.Auth) ([]*registry.ModelInfo, error) {
	token := ""
	if auth.Metadata != nil {
		if t, ok := auth.Metadata["access_token"].(string); ok {
			token = strings.TrimSpace(t)
		}
	}
	if token == "" && auth.Attributes != nil {
		token = strings.TrimSpace(auth.Attributes["api_key"])
	}
	if token == "" {
		resolved, errToken := h.resolveTokenForAuth(ctx, auth, "")
		if errToken != nil {
			return nil, fmt.Errorf("resolve antigravity token: %w", errToken)
		}
		token = strings.TrimSpace(resolved)
	}
	if token == "" {
		return nil, errors.New("antigravity access token is empty")
	}

	baseURL := "https://daily-cloudcode-pa.googleapis.com"
	if auth.Attributes != nil {
		if u := strings.TrimSpace(auth.Attributes["base_url"]); u != "" {
			baseURL = strings.TrimRight(u, "/")
		}
	}

	projectID := ""
	if auth.Metadata != nil {
		if p, ok := auth.Metadata["project_id"].(string); ok {
			projectID = strings.TrimSpace(p)
		}
	}
	if projectID == "" && auth.Attributes != nil {
		projectID = strings.TrimSpace(auth.Attributes["project_id"])
	}

	bodyMap := map[string]string{}
	if projectID != "" {
		bodyMap["project"] = projectID
	}
	bodyBytes, _ := json.Marshal(bodyMap)

	req, errReq := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/v1internal:fetchAvailableModels", bytes.NewReader(bodyBytes))
	if errReq != nil {
		return nil, fmt.Errorf("create antigravity request: %w", errReq)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", "antigravity/0.1.0")

	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: h.apiCallTransport(auth, ""),
	}
	resp, errDo := client.Do(req)
	if errDo != nil {
		return nil, fmt.Errorf("antigravity fetchAvailableModels: %w", errDo)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("antigravity upstream error (status %d): %s", resp.StatusCode, string(respBody))
	}

	respData, errRead := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if errRead != nil {
		return nil, fmt.Errorf("read antigravity response: %w", errRead)
	}

	modelsVal := gjson.GetBytes(respData, "models")
	if !modelsVal.Exists() || !modelsVal.IsObject() {
		// Fallback to static if models object missing
		if catalog := registry.GetAntigravityModels(); len(catalog) > 0 {
			return catalog, nil
		}
		return nil, errors.New("antigravity response did not contain models object")
	}

	modelMap := modelsVal.Map()
	ids := make([]string, 0, len(modelMap))
	for k := range modelMap {
		norm := strings.TrimSpace(k)
		if norm != "" {
			ids = append(ids, norm)
		}
	}
	sort.Strings(ids)

	result := make([]*registry.ModelInfo, 0, len(ids))
	for _, id := range ids {
		result = append(result, &registry.ModelInfo{ID: id})
	}
	return result, nil
}

func (h *Handler) fetchCodexUpstreamModels(ctx context.Context, auth *coreauth.Auth) ([]*registry.ModelInfo, error) {
	token, errToken := h.resolveTokenForAuth(ctx, auth, "")
	if errToken == nil && strings.TrimSpace(token) != "" {
		req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, "https://chatgpt.com/backend-api/models", nil)
		if errReq == nil {
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("User-Agent", "codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)")
			accountID := extractCodexAccountID(auth)
			if accountID != "" {
				req.Header.Set("Chatgpt-Account-Id", accountID)
			}

			client := &http.Client{
				Timeout:   15 * time.Second,
				Transport: h.apiCallTransport(auth, ""),
			}
			resp, errDo := client.Do(req)
			if errDo == nil {
				defer func() {
					_ = resp.Body.Close()
				}()
				if resp.StatusCode == http.StatusOK {
					data, errRead := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
					if errRead == nil {
						rawModels := gjson.GetBytes(data, "models").Array()
						if len(rawModels) > 0 {
							var models []*registry.ModelInfo
							seen := make(map[string]bool)
							for _, m := range rawModels {
								slug := strings.TrimSpace(m.Get("slug").String())
								if slug == "" {
									slug = strings.TrimSpace(m.Get("id").String())
								}
								if slug != "" && !seen[slug] {
									seen[slug] = true
									info := &registry.ModelInfo{ID: slug}
									if title := strings.TrimSpace(m.Get("title").String()); title != "" {
										info.DisplayName = title
									}
									models = append(models, info)
								}
							}
							if len(models) > 0 {
								return models, nil
							}
						}
					}
				}
			}
		}
	}

	// Fallback to plan type catalog models
	planType := ""
	if auth.Attributes != nil {
		planType = strings.TrimSpace(auth.Attributes["plan_type"])
	}
	switch strings.ToLower(planType) {
	case "free":
		return registry.GetCodexFreeModels(), nil
	case "plus":
		return registry.GetCodexPlusModels(), nil
	case "team", "business", "go":
		return registry.GetCodexTeamModels(), nil
	default:
		return registry.GetCodexProModels(), nil
	}
}

func (h *Handler) fetchClaudeUpstreamModels(ctx context.Context, auth *coreauth.Auth) ([]*registry.ModelInfo, error) {
	token, errToken := h.resolveTokenForAuth(ctx, auth, "")
	if errToken == nil && strings.TrimSpace(token) != "" {
		req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.anthropic.com/v1/models", nil)
		if errReq == nil {
			if strings.HasPrefix(token, "sk-ant-") {
				req.Header.Set("x-api-key", token)
			} else {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			req.Header.Set("anthropic-version", "2023-06-01")
			req.Header.Set("User-Agent", "cliproxyapi")

			client := &http.Client{
				Timeout:   15 * time.Second,
				Transport: h.apiCallTransport(auth, ""),
			}
			resp, errDo := client.Do(req)
			if errDo == nil {
				defer func() {
					_ = resp.Body.Close()
				}()
				if resp.StatusCode == http.StatusOK {
					data, errRead := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
					if errRead == nil {
						rawModels := gjson.GetBytes(data, "data").Array()
						if len(rawModels) > 0 {
							var models []*registry.ModelInfo
							seen := make(map[string]bool)
							for _, m := range rawModels {
								id := strings.TrimSpace(m.Get("id").String())
								if id != "" && !seen[id] {
									seen[id] = true
									info := &registry.ModelInfo{ID: id}
									if name := strings.TrimSpace(m.Get("display_name").String()); name != "" {
										info.DisplayName = name
									}
									models = append(models, info)
								}
							}
							if len(models) > 0 {
								return models, nil
							}
						}
					}
				}
			}
		}
	}

	return registry.GetClaudeModels(), nil
}

func (h *Handler) fetchGeminiUpstreamModels(ctx context.Context, auth *coreauth.Auth) ([]*registry.ModelInfo, error) {
	token, errToken := h.resolveTokenForAuth(ctx, auth, "")
	if errToken == nil && strings.TrimSpace(token) != "" {
		endpoint := "https://generativelanguage.googleapis.com/v1beta/models"
		req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if errReq == nil {
			if strings.HasPrefix(token, "AIza") || len(token) < 50 {
				q := req.URL.Query()
				q.Set("key", token)
				req.URL.RawQuery = q.Encode()
			} else {
				req.Header.Set("Authorization", "Bearer "+token)
			}

			client := &http.Client{
				Timeout:   15 * time.Second,
				Transport: h.apiCallTransport(auth, ""),
			}
			resp, errDo := client.Do(req)
			if errDo == nil {
				defer func() {
					_ = resp.Body.Close()
				}()
				if resp.StatusCode == http.StatusOK {
					data, errRead := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
					if errRead == nil {
						rawModels := gjson.GetBytes(data, "models").Array()
						if len(rawModels) > 0 {
							var models []*registry.ModelInfo
							seen := make(map[string]bool)
							for _, m := range rawModels {
								name := strings.TrimSpace(m.Get("name").String())
								name = strings.TrimPrefix(name, "models/")
								if name != "" && !seen[name] {
									seen[name] = true
									info := &registry.ModelInfo{ID: name}
									if dName := strings.TrimSpace(m.Get("displayName").String()); dName != "" {
										info.DisplayName = dName
									}
									models = append(models, info)
								}
							}
							if len(models) > 0 {
								return models, nil
							}
						}
					}
				}
			}
		}
	}

	return registry.GetGeminiModels(), nil
}

func (h *Handler) fetchOpenAICompatUpstreamModels(ctx context.Context, auth *coreauth.Auth) ([]*registry.ModelInfo, error) {
	token, _ := h.resolveTokenForAuth(ctx, auth, "")
	baseURL := ""
	if auth.Attributes != nil {
		baseURL = strings.TrimSpace(auth.Attributes["base_url"])
	}
	if baseURL == "" && h.cfg != nil {
		for _, compat := range h.cfg.OpenAICompatibility {
			if strings.EqualFold(compat.Name, auth.Provider) {
				baseURL = strings.TrimSpace(compat.BaseURL)
				break
			}
		}
	}
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}

	baseURL = strings.TrimRight(baseURL, "/")
	endpoint := baseURL + "/models"
	if !strings.HasSuffix(baseURL, "/v1") && !strings.Contains(baseURL, "/v1/") {
		endpoint = baseURL + "/v1/models"
	}

	req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if errReq != nil {
		return nil, fmt.Errorf("create request: %w", errReq)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{
		Timeout:   15 * time.Second,
		Transport: h.apiCallTransport(auth, ""),
	}
	resp, errDo := client.Do(req)
	if errDo != nil {
		return nil, fmt.Errorf("query openai-compat models: %w", errDo)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, string(respBody))
	}

	data, errRead := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if errRead != nil {
		return nil, errRead
	}

	rawModels := gjson.GetBytes(data, "data").Array()
	if len(rawModels) == 0 {
		rawModels = gjson.GetBytes(data, "models").Array()
	}

	var models []*registry.ModelInfo
	seen := make(map[string]bool)
	for _, m := range rawModels {
		id := strings.TrimSpace(m.Get("id").String())
		if id == "" {
			id = strings.TrimSpace(m.Get("name").String())
		}
		if id != "" && !seen[id] {
			seen[id] = true
			models = append(models, &registry.ModelInfo{ID: id})
		}
	}

	if len(models) == 0 {
		return nil, errors.New("no models found in upstream response")
	}
	return models, nil
}

func (h *Handler) fetchXAIUpstreamModels(ctx context.Context, auth *coreauth.Auth) ([]*registry.ModelInfo, error) {
	token, _ := h.resolveTokenForAuth(ctx, auth, "")
	if token != "" {
		req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.x.ai/v1/models", nil)
		if errReq == nil {
			req.Header.Set("Authorization", "Bearer "+token)
			client := &http.Client{Timeout: 15 * time.Second, Transport: h.apiCallTransport(auth, "")}
			resp, errDo := client.Do(req)
			if errDo == nil {
				defer func() { _ = resp.Body.Close() }()
				if resp.StatusCode == http.StatusOK {
					data, errRead := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
					if errRead == nil {
						rawModels := gjson.GetBytes(data, "data").Array()
						if len(rawModels) > 0 {
							var models []*registry.ModelInfo
							seen := make(map[string]bool)
							for _, m := range rawModels {
								id := strings.TrimSpace(m.Get("id").String())
								if id != "" && !seen[id] {
									seen[id] = true
									models = append(models, &registry.ModelInfo{ID: id})
								}
							}
							if len(models) > 0 {
								return models, nil
							}
						}
					}
				}
			}
		}
	}
	return registry.GetXAIModels(), nil
}

func (h *Handler) fetchKimiUpstreamModels(ctx context.Context, auth *coreauth.Auth) ([]*registry.ModelInfo, error) {
	token, _ := h.resolveTokenForAuth(ctx, auth, "")
	if token != "" {
		req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.moonshot.cn/v1/models", nil)
		if errReq == nil {
			req.Header.Set("Authorization", "Bearer "+token)
			client := &http.Client{Timeout: 15 * time.Second, Transport: h.apiCallTransport(auth, "")}
			resp, errDo := client.Do(req)
			if errDo == nil {
				defer func() { _ = resp.Body.Close() }()
				if resp.StatusCode == http.StatusOK {
					data, errRead := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
					if errRead == nil {
						rawModels := gjson.GetBytes(data, "data").Array()
						if len(rawModels) > 0 {
							var models []*registry.ModelInfo
							seen := make(map[string]bool)
							for _, m := range rawModels {
								id := strings.TrimSpace(m.Get("id").String())
								if id != "" && !seen[id] {
									seen[id] = true
									models = append(models, &registry.ModelInfo{ID: id})
								}
							}
							if len(models) > 0 {
								return models, nil
							}
						}
					}
				}
			}
		}
	}
	return registry.GetKimiModels(), nil
}
