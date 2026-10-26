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

func TestCustomPriceOverrides(t *testing.T) {
	tempDir := t.TempDir()
	cachePath := filepath.Join(tempDir, "prices.json")

	mgr := NewManager(cachePath)

	// 1. Model that doesn't exist anywhere
	customModel := "custom-zero-cost-model"
	if _, ok := mgr.GetPrice(customModel); ok {
		t.Fatalf("expected %s to have no price initially", customModel)
	}

	customPrice := ModelPrice{
		InputCostPerToken:     0.000005,
		OutputCostPerToken:    0.000015,
		CacheReadCostPerToken: 0.000001,
	}

	if err := mgr.SetCustomPrice(customModel, customPrice); err != nil {
		t.Fatalf("SetCustomPrice failed: %v", err)
	}

	gotPrice, ok := mgr.GetPrice(customModel)
	if !ok || gotPrice.InputCostPerToken != 0.000005 {
		t.Fatalf("GetPrice() = %v, ok=%v; want %v", gotPrice, ok, customPrice)
	}

	// Verify it's in GetCustomPrices
	customs := mgr.GetCustomPrices()
	if _, exists := customs[customModel]; !exists {
		t.Fatalf("expected %s in GetCustomPrices()", customModel)
	}

	// 2. Persistence test across new Manager instance
	mgr2 := NewManager(cachePath)
	gotPrice2, ok2 := mgr2.GetPrice(customModel)
	if !ok2 || gotPrice2.InputCostPerToken != 0.000005 {
		t.Fatalf("mgr2.GetPrice() = %v, ok=%v; want persisted custom price", gotPrice2, ok2)
	}
	customs2 := mgr2.GetCustomPrices()
	if _, exists := customs2[customModel]; !exists {
		t.Fatalf("expected %s in mgr2.GetCustomPrices()", customModel)
	}

	// 3. Test deleting custom price
	if err := mgr2.DeleteCustomPrice(customModel); err != nil {
		t.Fatalf("DeleteCustomPrice failed: %v", err)
	}
	if _, ok := mgr2.GetPrice(customModel); ok {
		t.Fatalf("expected %s to be deleted from prices", customModel)
	}
	if _, ok := mgr2.GetCustomPrices()[customModel]; ok {
		t.Fatalf("expected %s to be deleted from custom prices", customModel)
	}

	// 4. Overriding an existing seed model (e.g. gpt-4o) and reverting
	origGpt4o, _ := mgr2.GetPrice("gpt-4o")
	overridePrice := ModelPrice{InputCostPerToken: 99.0, OutputCostPerToken: 99.0}
	if err := mgr2.SetCustomPrice("gpt-4o", overridePrice); err != nil {
		t.Fatalf("SetCustomPrice gpt-4o failed: %v", err)
	}
	gotGpt4o, _ := mgr2.GetPrice("gpt-4o")
	if gotGpt4o.InputCostPerToken != 99.0 {
		t.Fatalf("expected custom override 99.0, got %v", gotGpt4o.InputCostPerToken)
	}

	// Delete override should revert to default seed price
	if err := mgr2.DeleteCustomPrice("gpt-4o"); err != nil {
		t.Fatalf("DeleteCustomPrice gpt-4o failed: %v", err)
	}
	revertedGpt4o, _ := mgr2.GetPrice("gpt-4o")
	if revertedGpt4o.InputCostPerToken != origGpt4o.InputCostPerToken {
		t.Fatalf("expected reverted price %v, got %v", origGpt4o.InputCostPerToken, revertedGpt4o.InputCostPerToken)
	}
}
