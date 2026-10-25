package pricing

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"
)

const (
	litellmPricesURL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
	openRouterURL    = "https://openrouter.ai/api/v1/models"
)

// litellmEntry represents the pricing fields in LiteLLM's model JSON.
type litellmEntry struct {
	InputCostPerToken     float64 `json:"input_cost_per_token"`
	OutputCostPerToken    float64 `json:"output_cost_per_token"`
	CacheReadCostPerToken float64 `json:"cache_read_input_token_cost"`
}

// openRouterResponse represents the OpenRouter /api/v1/models response.
type openRouterResponse struct {
	Data []struct {
		ID      string `json:"id"`
		Pricing struct {
			Prompt         string `json:"prompt"`
			Completion     string `json:"completion"`
			InputCacheRead string `json:"input_cache_read"`
		} `json:"pricing"`
	} `json:"data"`
}

// FetchRemotePrices downloads prices from LiteLLM and OpenRouter and merges them.
func FetchRemotePrices(ctx context.Context) map[string]ModelPrice {
	result := make(map[string]ModelPrice, 4000)

	client := &http.Client{
		Timeout: 25 * time.Second,
	}

	// 1. Fetch LiteLLM prices
	litellmURL := litellmPricesURL
	if ghProxy := os.Getenv("GH_PROXY"); ghProxy != "" {
		ghProxy = strings.TrimRight(ghProxy, "/")
		litellmURL = ghProxy + "/" + litellmPricesURL
	}
	fetchLiteLLM(ctx, client, litellmURL, result)

	// 2. Fetch OpenRouter prices
	fetchOpenRouter(ctx, client, openRouterURL, result)

	return result
}

func fetchLiteLLM(ctx context.Context, client *http.Client, url string, target map[string]ModelPrice) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		log.WithError(err).Warn("pricing: failed to create litellm request")
		return
	}
	req.Header.Set("User-Agent", "CLIProxyAPI-PriceFetcher/1.0")

	resp, err := client.Do(req)
	if err != nil {
		log.WithError(err).Warn("pricing: failed to fetch litellm model prices")
		return
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != http.StatusOK {
		log.Warnf("pricing: litellm returned HTTP %d", resp.StatusCode)
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.WithError(err).Warn("pricing: failed to read litellm body")
		return
	}

	var rawMap map[string]litellmEntry
	if err := json.Unmarshal(body, &rawMap); err != nil {
		log.WithError(err).Warn("pricing: failed to parse litellm json")
		return
	}

	count := 0
	for modelName, entry := range rawMap {
		if modelName == "sample_spec" || (entry.InputCostPerToken <= 0 && entry.OutputCostPerToken <= 0) {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(modelName))
		target[key] = ModelPrice{
			InputCostPerToken:     entry.InputCostPerToken,
			OutputCostPerToken:    entry.OutputCostPerToken,
			CacheReadCostPerToken: entry.CacheReadCostPerToken,
		}
		count++
	}
	log.Infof("pricing: successfully parsed %d model prices from LiteLLM", count)
}

func fetchOpenRouter(ctx context.Context, client *http.Client, url string, target map[string]ModelPrice) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		log.WithError(err).Warn("pricing: failed to create openrouter request")
		return
	}
	req.Header.Set("User-Agent", "CLIProxyAPI-PriceFetcher/1.0")

	resp, err := client.Do(req)
	if err != nil {
		log.WithError(err).Warn("pricing: failed to fetch openrouter model prices")
		return
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != http.StatusOK {
		log.Warnf("pricing: openrouter returned HTTP %d", resp.StatusCode)
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.WithError(err).Warn("pricing: failed to read openrouter body")
		return
	}

	var orResp openRouterResponse
	if err := json.Unmarshal(body, &orResp); err != nil {
		log.WithError(err).Warn("pricing: failed to parse openrouter json")
		return
	}

	count := 0
	for _, m := range orResp.Data {
		inCost, _ := strconv.ParseFloat(m.Pricing.Prompt, 64)
		outCost, _ := strconv.ParseFloat(m.Pricing.Completion, 64)
		cacheCost, _ := strconv.ParseFloat(m.Pricing.InputCacheRead, 64)
		if inCost <= 0 && outCost <= 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(m.ID))
		target[key] = ModelPrice{
			InputCostPerToken:     inCost,
			OutputCostPerToken:    outCost,
			CacheReadCostPerToken: cacheCost,
		}
		// Also store without provider prefix if not already present
		if idx := strings.Index(key, "/"); idx >= 0 && idx < len(key)-1 {
			shortKey := key[idx+1:]
			if _, exists := target[shortKey]; !exists {
				target[shortKey] = target[key]
			}
		}
		count++
	}
	log.Infof("pricing: successfully parsed %d model prices from OpenRouter", count)
}
