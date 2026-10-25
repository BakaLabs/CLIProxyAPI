package pricing

// ModelPrice defines per-token USD pricing for an LLM model.
type ModelPrice struct {
	InputCostPerToken     float64 `json:"input_cost_per_token"`
	OutputCostPerToken    float64 `json:"output_cost_per_token"`
	CacheReadCostPerToken float64 `json:"cache_read_cost_per_token"`
}
