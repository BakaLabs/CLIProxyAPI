package management

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/pluginhost"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	log "github.com/sirupsen/logrus"
	"github.com/tidwall/gjson"
)

// isBuiltinQuotaProvider reports whether the provider has built-in active quota probing support.
func isBuiltinQuotaProvider(provider string) bool {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "codex", "claude", "antigravity", "deepseek", "kimi", "kimi-ai", "xai", "grok", "x-ai":
		return true
	default:
		return false
	}
}

// builtinQuotaProviders returns descriptors for all natively supported quota providers.
func builtinQuotaProviders() []pluginhost.RegisteredQuotaProviderInfo {
	return []pluginhost.RegisteredQuotaProviderInfo{
		{
			PluginID:           "builtin:codex",
			Provider:           "codex",
			DisplayName:        "Codex",
			SupportedProviders: []string{"codex"},
			SupportsReset:      true,
		},
		{
			PluginID:           "builtin:claude",
			Provider:           "claude",
			DisplayName:        "Claude",
			SupportedProviders: []string{"claude"},
			SupportsReset:      true,
		},
		{
			PluginID:           "builtin:antigravity",
			Provider:           "antigravity",
			DisplayName:        "Antigravity",
			SupportedProviders: []string{"antigravity"},
			SupportsReset:      true,
		},
		{
			PluginID:           "builtin:deepseek",
			Provider:           "deepseek",
			DisplayName:        "DeepSeek",
			SupportedProviders: []string{"deepseek"},
			SupportsReset:      true,
		},
		{
			PluginID:           "builtin:kimi",
			Provider:           "kimi",
			DisplayName:        "Kimi",
			SupportedProviders: []string{"kimi", "kimi-ai"},
			SupportsReset:      true,
		},
		{
			PluginID:           "builtin:xai",
			Provider:           "xai",
			DisplayName:        "xAI",
			SupportedProviders: []string{"xai", "grok", "x-ai"},
			SupportsReset:      true,
		},
	}
}

// fetchBuiltinCredentialQuota dispatches active quota probing to native provider implementations.
func (h *Handler) fetchBuiltinCredentialQuota(ctx context.Context, auth *coreauth.Auth, provider string) (bool, any, error) {
	if auth == nil {
		return false, nil, nil
	}
	p := strings.ToLower(strings.TrimSpace(provider))
	if strings.HasPrefix(p, "builtin:") {
		p = strings.TrimPrefix(p, "builtin:")
	}
	if p == "" {
		p = strings.ToLower(strings.TrimSpace(auth.Provider))
	}
	if p == "" && auth.Metadata != nil {
		if t, ok := auth.Metadata["type"].(string); ok {
			p = strings.ToLower(strings.TrimSpace(t))
		}
	}

	switch p {
	case "codex":
		resp, err := h.fetchCodexQuota(ctx, auth)
		return true, resp, err
	case "claude":
		resp, err := h.fetchClaudeQuota(ctx, auth)
		return true, resp, err
	case "antigravity":
		resp, err := h.fetchAntigravityQuota(ctx, auth)
		return true, resp, err
	case "deepseek":
		resp, err := h.fetchDeepSeekQuota(ctx, auth)
		return true, resp, err
	case "kimi", "kimi-ai":
		resp, err := h.fetchKimiQuota(ctx, auth)
		return true, resp, err
	case "xai", "grok", "x-ai":
		resp, err := h.fetchXAIQuota(ctx, auth)
		return true, resp, err
	default:
		return false, nil, nil
	}
}

// resetBuiltinCredentialQuota resets cooldown state and attempts upstream credit redemptions.
func (h *Handler) resetBuiltinCredentialQuota(ctx context.Context, auth *coreauth.Auth, provider string) (bool, any, error) {
	if auth == nil {
		return false, nil, nil
	}
	p := strings.ToLower(strings.TrimSpace(provider))
	if strings.HasPrefix(p, "builtin:") {
		p = strings.TrimPrefix(p, "builtin:")
	}
	if p == "" {
		p = strings.ToLower(strings.TrimSpace(auth.Provider))
	}
	if !isBuiltinQuotaProvider(p) {
		return false, nil, nil
	}

	// Codex specific upstream reset credit redemption attempt
	if p == "codex" {
		token, _ := h.resolveTokenForAuth(ctx, auth, "")
		if token != "" {
			resetURL := "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume"
			payload := fmt.Sprintf(`{"redeem_request_id":%q}`, uuid.NewString())
			reqReset, errReq := http.NewRequestWithContext(ctx, http.MethodPost, resetURL, strings.NewReader(payload))
			if errReq == nil {
				reqReset.Header.Set("Authorization", "Bearer "+token)
				reqReset.Header.Set("Content-Type", "application/json")
				reqReset.Header.Set("User-Agent", "codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)")
				if accountID := extractCodexAccountID(auth); accountID != "" {
					reqReset.Header.Set("Chatgpt-Account-Id", accountID)
				}
				client := &http.Client{Timeout: 15 * time.Second, Transport: h.apiCallTransport(auth, "")}
				if respReset, errDo := client.Do(reqReset); errDo == nil {
					_ = respReset.Body.Close()
				}
			}
		}
	}

	// Clear local routing cooldown
	if h.authManager != nil {
		updated, _, errReset := h.authManager.ResetQuota(ctx, auth.ID)
		if errReset != nil {
			return true, nil, fmt.Errorf("reset routing quota: %w", errReset)
		}
		if updated != nil {
			updated.EnsureIndex()
		}
	}

	return true, gin.H{
		"status":     "ok",
		"auth_index": auth.Index,
		"message":    "已重置凭据冷却状态与本地配额",
	}, nil
}

func extractCodexAccountID(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if auth.Metadata != nil {
		if v, ok := auth.Metadata["chatgpt_account_id"].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	if auth.Attributes != nil {
		if v, ok := auth.Attributes["chatgpt_account_id"]; ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	if idToken, ok := auth.Metadata["id_token"].(string); ok && idToken != "" {
		parts := strings.Split(idToken, ".")
		if len(parts) >= 2 {
			payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
			if err == nil {
				accID := gjson.GetBytes(payloadBytes, "chatgpt_account_id").String()
				if accID == "" {
					accID = gjson.GetBytes(payloadBytes, "https://api\\.openai\\.com/auth.chatgpt_account_id").String()
				}
				if accID != "" {
					return accID
				}
			}
		}
	}
	return ""
}

func formatWindowLabel(seconds int64, defaultLabel string) string {
	switch {
	case seconds == 18000 || seconds == 300:
		return "5小时限额"
	case seconds == 604800:
		return "周限额"
	case seconds >= 2592000:
		return "月限额"
	case seconds > 0:
		hours := seconds / 3600
		if hours > 0 {
			return fmt.Sprintf("%d小时限额", hours)
		}
		return fmt.Sprintf("%d秒限额", seconds)
	default:
		return defaultLabel
	}
}

func (h *Handler) fetchCodexQuota(ctx context.Context, auth *coreauth.Auth) (any, error) {
	token, errToken := h.resolveTokenForAuth(ctx, auth, "")
	if errToken != nil {
		return nil, fmt.Errorf("resolve codex token: %w", errToken)
	}
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("codex access token is empty")
	}

	req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, "https://chatgpt.com/backend-api/wham/usage", nil)
	if errReq != nil {
		return nil, fmt.Errorf("build codex request: %w", errReq)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)")

	accountID := extractCodexAccountID(auth)
	if accountID != "" {
		req.Header.Set("Chatgpt-Account-Id", accountID)
	}

	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: h.apiCallTransport(auth, ""),
	}

	resp, errDo := client.Do(req)
	if errDo != nil {
		return nil, fmt.Errorf("call codex wham/usage: %w", errDo)
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.Errorf("codex quota body close error: %v", errClose)
		}
	}()

	bodyBytes, errRead := io.ReadAll(resp.Body)
	if errRead != nil {
		return nil, fmt.Errorf("read codex response: %w", errRead)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("upstream error (HTTP %d): %s", resp.StatusCode, string(bodyBytes))
	}

	root := gjson.ParseBytes(bodyBytes)
	planType := root.Get("plan_type").String()
	if planType == "" {
		planType = "free"
	}

	var buckets []map[string]any

	primary := root.Get("rate_limit.primary_window")
	if primary.Exists() && primary.Get("used_percent").Exists() && primary.Get("used_percent").Type != gjson.Null {
		usedPct := primary.Get("used_percent").Float()
		remPct := math.Max(0, math.Min(100, 100-usedPct))
		remFrac := remPct / 100.0

		bucket := map[string]any{
			"window":             formatWindowLabel(primary.Get("limit_window_seconds").Int(), "主要限额"),
			"remaining_fraction": remFrac,
			"remaining_percent":  math.Round(remPct),
			"used_percent":       usedPct,
		}
		if resetAt := primary.Get("reset_at").Int(); resetAt > 0 {
			bucket["reset_time"] = time.Unix(resetAt, 0).UTC().Format(time.RFC3339)
		}
		buckets = append(buckets, bucket)
	}

	secondary := root.Get("rate_limit.secondary_window")
	if secondary.Exists() && secondary.Get("used_percent").Exists() && secondary.Get("used_percent").Type != gjson.Null {
		usedPct := secondary.Get("used_percent").Float()
		remPct := math.Max(0, math.Min(100, 100-usedPct))
		remFrac := remPct / 100.0

		bucket := map[string]any{
			"window":             formatWindowLabel(secondary.Get("limit_window_seconds").Int(), "周限额"),
			"remaining_fraction": remFrac,
			"remaining_percent":  math.Round(remPct),
			"used_percent":       usedPct,
		}
		if resetAt := secondary.Get("reset_at").Int(); resetAt > 0 {
			bucket["reset_time"] = time.Unix(resetAt, 0).UTC().Format(time.RFC3339)
		}
		buckets = append(buckets, bucket)
	}

	addLimits := root.Get("additional_rate_limits")
	if addLimits.IsArray() {
		for _, item := range addLimits.Array() {
			name := item.Get("name").String()
			win := item.Get("window")
			if !win.Exists() {
				win = item
			}
			if win.Get("used_percent").Exists() && win.Get("used_percent").Type != gjson.Null {
				usedPct := win.Get("used_percent").Float()
				remPct := math.Max(0, math.Min(100, 100-usedPct))
				remFrac := remPct / 100.0
				bucket := map[string]any{
					"window":             name,
					"remaining_fraction": remFrac,
					"remaining_percent":  math.Round(remPct),
					"used_percent":       usedPct,
				}
				if resetAt := win.Get("reset_at").Int(); resetAt > 0 {
					bucket["reset_time"] = time.Unix(resetAt, 0).UTC().Format(time.RFC3339)
				}
				buckets = append(buckets, bucket)
			}
		}
	}

	planDisplay := strings.ToUpper(planType[:1]) + planType[1:]

	result := map[string]any{
		"plan":         planDisplay,
		"plan_type":    planType,
		"subscription": map[string]any{"plan": planDisplay},
		"buckets":      buckets,
		"credits":      root.Get("credits").Value(),
		"user_id":      root.Get("user_id").String(),
		"email":        root.Get("email").String(),
		"raw":          root.Value(),
	}

	if resets := root.Get("rate_limit_reset_credits"); resets.Exists() {
		result["rate_limit_reset_credits"] = resets.Value()
	}

	return result, nil
}

func (h *Handler) fetchClaudeQuota(ctx context.Context, auth *coreauth.Auth) (any, error) {
	token, errToken := h.resolveTokenForAuth(ctx, auth, "")
	if errToken != nil {
		return nil, fmt.Errorf("resolve claude token: %w", errToken)
	}
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("claude access token is empty")
	}

	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: h.apiCallTransport(auth, ""),
	}

	reqUsage, errReq := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.anthropic.com/api/oauth/usage", nil)
	if errReq != nil {
		return nil, fmt.Errorf("build claude usage request: %w", errReq)
	}
	reqUsage.Header.Set("Authorization", "Bearer "+token)
	reqUsage.Header.Set("Accept", "application/json")
	reqUsage.Header.Set("anthropic-beta", "oauth-2025-04-20")
	reqUsage.Header.Set("User-Agent", "claude-cli/2.1.280 (external, cli)")

	respUsage, errDo := client.Do(reqUsage)
	if errDo != nil {
		return nil, fmt.Errorf("call claude usage: %w", errDo)
	}
	defer func() {
		if errClose := respUsage.Body.Close(); errClose != nil {
			log.Errorf("claude usage body close error: %v", errClose)
		}
	}()

	usageBytes, errRead := io.ReadAll(respUsage.Body)
	if errRead != nil {
		return nil, fmt.Errorf("read claude response: %w", errRead)
	}
	if respUsage.StatusCode < 200 || respUsage.StatusCode >= 300 {
		return nil, fmt.Errorf("claude usage upstream error (HTTP %d): %s", respUsage.StatusCode, string(usageBytes))
	}

	planName := "Free"
	reqProfile, errP := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.anthropic.com/api/oauth/profile", nil)
	if errP == nil {
		reqProfile.Header.Set("Authorization", "Bearer "+token)
		reqProfile.Header.Set("anthropic-beta", "oauth-2025-04-20")
		reqProfile.Header.Set("User-Agent", "claude-cli/2.1.280 (external, cli)")
		if respProfile, errProf := client.Do(reqProfile); errProf == nil {
			defer func() {
				if errClose := respProfile.Body.Close(); errClose != nil {
					log.Errorf("claude profile body close error: %v", errClose)
				}
			}()
			if profBytes, errProfRead := io.ReadAll(respProfile.Body); errProfRead == nil {
				profJSON := gjson.ParseBytes(profBytes)
				if profJSON.Get("account.has_claude_max").Bool() {
					planName = "Max"
				} else if profJSON.Get("account.has_claude_pro").Bool() {
					planName = "Pro"
				}
			}
		}
	}

	usageJSON := gjson.ParseBytes(usageBytes)
	var buckets []map[string]any

	windowMap := map[string]string{
		"five_hour":            "5小时限额",
		"seven_day":            "周限额",
		"seven_day_oauth_apps": "周限额 (OAuth Apps)",
		"seven_day_opus":       "周限额 (Opus)",
		"seven_day_sonnet":     "周限额 (Sonnet)",
		"seven_day_cowork":     "周限额 (Cowork)",
	}

	usageJSON.ForEach(func(key, val gjson.Result) bool {
		if val.Get("utilization").Exists() && val.Get("utilization").Type != gjson.Null {
			util := val.Get("utilization").Float()
			remFrac := math.Max(0, math.Min(1.0, 1.0-util))
			remPct := math.Round(remFrac * 100)

			label := windowMap[key.String()]
			if label == "" {
				label = key.String()
			}

			bucket := map[string]any{
				"window":             label,
				"remaining_fraction": remFrac,
				"remaining_percent":  remPct,
				"used_percent":       math.Round(util * 100),
			}
			if resetsAt := val.Get("resets_at").String(); resetsAt != "" {
				bucket["reset_time"] = resetsAt
			}
			buckets = append(buckets, bucket)
		}
		return true
	})

	return map[string]any{
		"plan":         planName,
		"subscription": map[string]any{"plan": planName},
		"buckets":      buckets,
		"raw":          usageJSON.Value(),
	}, nil
}

func (h *Handler) fetchAntigravityQuota(ctx context.Context, auth *coreauth.Auth) (any, error) {
	token, errToken := h.resolveTokenForAuth(ctx, auth, "")
	if errToken != nil {
		return nil, fmt.Errorf("resolve antigravity token: %w", errToken)
	}
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("antigravity access token is empty")
	}

	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: h.apiCallTransport(auth, ""),
	}

	// 1. Resolve project ID from auth attributes/metadata
	projectID := ""
	if auth.Attributes != nil {
		if pid, ok := auth.Attributes["project_id"]; ok && strings.TrimSpace(pid) != "" {
			projectID = strings.TrimSpace(pid)
		} else if pid, ok := auth.Attributes["projectId"]; ok && strings.TrimSpace(pid) != "" {
			projectID = strings.TrimSpace(pid)
		}
	}
	if projectID == "" && auth.Metadata != nil {
		if pid, ok := auth.Metadata["project_id"].(string); ok && strings.TrimSpace(pid) != "" {
			projectID = strings.TrimSpace(pid)
		} else if pid, ok := auth.Metadata["projectId"].(string); ok && strings.TrimSpace(pid) != "" {
			projectID = strings.TrimSpace(pid)
		}
	}

	planName := "Antigravity"
	if projectID == "" {
		loadReqBody := `{"metadata":{"client_info":{"client_type":"ANTIGRAVITY","client_version":"1.0.0"}}}`
		for _, endpoint := range []string{
			"https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
			"https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
		} {
			reqLoad, errRL := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(loadReqBody))
			if errRL != nil {
				continue
			}
			reqLoad.Header.Set("Authorization", "Bearer "+token)
			reqLoad.Header.Set("Content-Type", "application/json")
			reqLoad.Header.Set("User-Agent", "antigravity/1.0.0")

			respLoad, errDo := client.Do(reqLoad)
			if errDo == nil {
				loadBytes, _ := io.ReadAll(respLoad.Body)
				_ = respLoad.Body.Close()
				if respLoad.StatusCode == http.StatusOK {
					loadRes := gjson.ParseBytes(loadBytes)
					if pid := loadRes.Get("cloudaicompanionProject.projectId").String(); pid != "" {
						projectID = pid
					} else if pid := loadRes.Get("cloudaicompanionProject.id").String(); pid != "" {
						projectID = pid
					}
					if p := loadRes.Get("plan").String(); p != "" {
						planName = p
					} else if p := loadRes.Get("tierName").String(); p != "" {
						planName = p
					}
					if projectID != "" {
						break
					}
				}
			}
		}
	}

	if projectID == "" {
		return nil, errors.New("antigravity project ID not found in credentials or upstream loadCodeAssist")
	}

	summaryReqBody := fmt.Sprintf(`{"project":%q}`, projectID)
	var summaryBytes []byte
	var lastErr error
	for _, endpoint := range []string{
		"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
		"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
	} {
		reqSummary, errReq := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(summaryReqBody))
		if errReq != nil {
			continue
		}
		reqSummary.Header.Set("Authorization", "Bearer "+token)
		reqSummary.Header.Set("Content-Type", "application/json")
		reqSummary.Header.Set("User-Agent", "antigravity/1.0.0")

		respSummary, errDo := client.Do(reqSummary)
		if errDo != nil {
			lastErr = errDo
			continue
		}
		summaryBytes, _ = io.ReadAll(respSummary.Body)
		_ = respSummary.Body.Close()
		if respSummary.StatusCode == http.StatusOK {
			lastErr = nil
			break
		}
		lastErr = fmt.Errorf("upstream error (HTTP %d): %s", respSummary.StatusCode, string(summaryBytes))
	}

	if lastErr != nil && len(summaryBytes) == 0 {
		return nil, fmt.Errorf("call antigravity retrieveUserQuotaSummary: %w", lastErr)
	}

	root := gjson.ParseBytes(summaryBytes)
	groupsRes := root.Get("groups")
	var buckets []map[string]any

	if groupsRes.IsArray() {
		for _, grp := range groupsRes.Array() {
			grpName := grp.Get("displayName").String()
			if grpName == "" {
				grpName = grp.Get("display_name").String()
			}
			bArr := grp.Get("buckets")
			if bArr.IsArray() {
				for _, b := range bArr.Array() {
					remFracRes := b.Get("remainingFraction")
					if !remFracRes.Exists() || remFracRes.Type == gjson.Null {
						remFracRes = b.Get("remaining_fraction")
					}
					if remFracRes.Exists() && remFracRes.Type != gjson.Null {
						remFrac := remFracRes.Float()
						remPct := math.Round(remFrac * 100)
						usedPct := math.Max(0, math.Min(100, 100-remPct))

						bName := b.Get("displayName").String()
						if bName == "" {
							bName = b.Get("display_name").String()
						}
						if bName == "" {
							bName = b.Get("window").String()
						}
						label := bName
						if grpName != "" && grpName != bName {
							label = fmt.Sprintf("%s - %s", grpName, bName)
						}

						bucket := map[string]any{
							"window":             label,
							"remaining_fraction": remFrac,
							"remaining_percent":  remPct,
							"used_percent":       usedPct,
						}
						resetTime := b.Get("resetTime").String()
						if resetTime == "" {
							resetTime = b.Get("reset_time").String()
						}
						if resetTime != "" {
							bucket["reset_time"] = resetTime
						}
						buckets = append(buckets, bucket)
					}
				}
			}
		}
	}

	return map[string]any{
		"plan":         planName,
		"subscription": map[string]any{"plan": planName},
		"project_id":   projectID,
		"buckets":      buckets,
		"raw":          root.Value(),
	}, nil
}

func (h *Handler) fetchDeepSeekQuota(ctx context.Context, auth *coreauth.Auth) (any, error) {
	token, errToken := h.resolveTokenForAuth(ctx, auth, "")
	if errToken != nil {
		return nil, fmt.Errorf("resolve deepseek token: %w", errToken)
	}
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("deepseek api key is empty")
	}

	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: h.apiCallTransport(auth, ""),
	}

	req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.deepseek.com/user/balance", nil)
	if errReq != nil {
		return nil, errReq
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, errDo := client.Do(req)
	if errDo != nil {
		return nil, fmt.Errorf("call deepseek balance: %w", errDo)
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.Errorf("deepseek quota body close error: %v", errClose)
		}
	}()

	bodyBytes, errRead := io.ReadAll(resp.Body)
	if errRead != nil {
		return nil, errRead
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("deepseek balance upstream error (HTTP %d): %s", resp.StatusCode, string(bodyBytes))
	}

	root := gjson.ParseBytes(bodyBytes)
	return map[string]any{
		"plan":          "DeepSeek",
		"subscription":  map[string]any{"plan": "DeepSeek"},
		"is_available":  root.Get("is_available").Bool(),
		"balance_infos": root.Get("balance_infos").Value(),
		"raw":           root.Value(),
	}, nil
}

func (h *Handler) fetchKimiQuota(ctx context.Context, auth *coreauth.Auth) (any, error) {
	token, errToken := h.resolveTokenForAuth(ctx, auth, "")
	if errToken != nil {
		return nil, fmt.Errorf("resolve kimi token: %w", errToken)
	}
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("kimi token is empty")
	}

	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: h.apiCallTransport(auth, ""),
	}

	req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.kimi.com/coding/v1/usages", nil)
	if errReq != nil {
		return nil, errReq
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, errDo := client.Do(req)
	if errDo != nil {
		req2, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.kimi.ai/coding/v1/usages", nil)
		req2.Header.Set("Authorization", "Bearer "+token)
		resp, errDo = client.Do(req2)
		if errDo != nil {
			return nil, fmt.Errorf("call kimi usages: %w", errDo)
		}
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.Errorf("kimi quota body close error: %v", errClose)
		}
	}()

	bodyBytes, errRead := io.ReadAll(resp.Body)
	if errRead != nil {
		return nil, errRead
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("kimi upstream error (HTTP %d): %s", resp.StatusCode, string(bodyBytes))
	}

	root := gjson.ParseBytes(bodyBytes)
	return map[string]any{
		"plan":         "Kimi",
		"subscription": map[string]any{"plan": "Kimi"},
		"raw":          root.Value(),
	}, nil
}

func (h *Handler) fetchXAIQuota(ctx context.Context, auth *coreauth.Auth) (any, error) {
	token, errToken := h.resolveTokenForAuth(ctx, auth, "")
	if errToken != nil {
		return nil, fmt.Errorf("resolve xai token: %w", errToken)
	}
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("xai token is empty")
	}

	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: h.apiCallTransport(auth, ""),
	}

	req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, "https://cli-chat-proxy.grok.com/v1/billing?format=credits", nil)
	if errReq != nil {
		return nil, errReq
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, errDo := client.Do(req)
	if errDo != nil {
		return nil, fmt.Errorf("call xai billing: %w", errDo)
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.Errorf("xai quota body close error: %v", errClose)
		}
	}()

	bodyBytes, errRead := io.ReadAll(resp.Body)
	if errRead != nil {
		return nil, errRead
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("xai billing upstream error (HTTP %d): %s", resp.StatusCode, string(bodyBytes))
	}

	root := gjson.ParseBytes(bodyBytes)
	return map[string]any{
		"plan":         "xAI",
		"subscription": map[string]any{"plan": "xAI"},
		"raw":          root.Value(),
	}, nil
}
