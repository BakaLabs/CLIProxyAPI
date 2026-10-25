package pricing

import (
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestFindPrice(t *testing.T) {
	catalog := map[string]ModelPrice{
		"gpt-4o":            {InputCostPerToken: 2.5e-06, OutputCostPerToken: 1.0e-05, CacheReadCostPerToken: 1.25e-06},
		"claude-3-5-sonnet": {InputCostPerToken: 3.0e-06, OutputCostPerToken: 1.5e-05, CacheReadCostPerToken: 3.0e-07},
		"deepseek-chat":     {InputCostPerToken: 1.4e-07, OutputCostPerToken: 2.8e-07, CacheReadCostPerToken: 1.4e-08},
	}

	tests := []struct {
		name      string
		query     string
		wantFound bool
		wantInput float64
	}{
		{"exact match", "gpt-4o", true, 2.5e-06},
		{"uppercase", "GPT-4O", true, 2.5e-06},
		{"provider prefix", "openai/gpt-4o", true, 2.5e-06},
		{"date suffix", "claude-3-5-sonnet-20241022", true, 3.0e-06},
		{"provider and date suffix", "anthropic/claude-3-5-sonnet-20241022", true, 3.0e-06},
		{"deepseek exact", "deepseek-chat", true, 1.4e-07},
		{"deepseek with prefix", "deepseek-ai/deepseek-chat", true, 1.4e-07},
		{"unknown model", "unknown-super-model-xyz", false, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, found := FindPrice(catalog, tt.query)
			if found != tt.wantFound {
				t.Fatalf("FindPrice(%q) found = %v, want %v", tt.query, found, tt.wantFound)
			}
			if found && math.Abs(p.InputCostPerToken-tt.wantInput) > 1e-12 {
				t.Fatalf("FindPrice(%q) input = %v, want %v", tt.query, p.InputCostPerToken, tt.wantInput)
			}
		})
	}
}

func TestCalculateCost(t *testing.T) {
	mgr := NewManager("")

	// Test gpt-4o: 1M input = $2.50, 1M output = $10.00
	cost := mgr.CalculateCost("gpt-4o", 1_000_000, 1_000_000, 0)
	expected := 12.50
	if math.Abs(cost-expected) > 1e-4 {
		t.Fatalf("CalculateCost() = %v, want %v", cost, expected)
	}

	// Test cache read: 1M input with 500k cache read
	// Uncached: 500k * 2.5e-6 = $1.25
	// Cached: 500k * 1.25e-6 = $0.625
	// Total = $1.875
	costCache := mgr.CalculateCost("gpt-4o", 1_000_000, 0, 500_000)
	expectedCache := 1.875
	if math.Abs(costCache-expectedCache) > 1e-4 {
		t.Fatalf("CalculateCost() with cache = %v, want %v", costCache, expectedCache)
	}
}

func TestCachePersistence(t *testing.T) {
	tempDir := t.TempDir()
	cachePath := filepath.Join(tempDir, "prices.json")

	mgr := NewManager(cachePath)
	mgr.mu.Lock()
	mgr.prices["custom-test-model"] = ModelPrice{
		InputCostPerToken:  0.01,
		OutputCostPerToken: 0.02,
	}
	mgr.mu.Unlock()

	if err := saveCache(cachePath, mgr.prices); err != nil {
		t.Fatalf("saveCache failed: %v", err)
	}

	// Verify file was written
	if _, err := os.Stat(cachePath); err != nil {
		t.Fatalf("cache file missing: %v", err)
	}

	// Load into a new manager
	mgr2 := NewManager(cachePath)
	p, ok := mgr2.GetPrice("custom-test-model")
	if !ok || p.InputCostPerToken != 0.01 {
		t.Fatalf("mgr2.GetPrice() = %v, ok=%v, want 0.01", p, ok)
	}
}
