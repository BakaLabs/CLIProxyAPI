package pricing

// defaultPrices provides immediate out-of-the-box pricing for the most common models,
// ensuring accurate cost calculations even before remote sync or when running offline.
var defaultPrices = map[string]ModelPrice{
	// OpenAI
	"gpt-4o":        {InputCostPerToken: 2.5e-06, OutputCostPerToken: 1.0e-05, CacheReadCostPerToken: 1.25e-06},
	"gpt-4o-mini":   {InputCostPerToken: 1.5e-07, OutputCostPerToken: 6.0e-07, CacheReadCostPerToken: 7.5e-08},
	"gpt-4-turbo":   {InputCostPerToken: 1.0e-05, OutputCostPerToken: 3.0e-05, CacheReadCostPerToken: 5.0e-06},
	"gpt-4":         {InputCostPerToken: 3.0e-05, OutputCostPerToken: 6.0e-05, CacheReadCostPerToken: 1.5e-05},
	"gpt-3.5-turbo": {InputCostPerToken: 5.0e-07, OutputCostPerToken: 1.5e-06, CacheReadCostPerToken: 2.5e-07},
	"o1":            {InputCostPerToken: 1.5e-05, OutputCostPerToken: 6.0e-05, CacheReadCostPerToken: 7.5e-06},
	"o1-mini":       {InputCostPerToken: 1.1e-06, OutputCostPerToken: 4.4e-06, CacheReadCostPerToken: 5.5e-07},
	"o1-preview":    {InputCostPerToken: 1.5e-05, OutputCostPerToken: 6.0e-05, CacheReadCostPerToken: 7.5e-06},
	"o3-mini":       {InputCostPerToken: 1.1e-06, OutputCostPerToken: 4.4e-06, CacheReadCostPerToken: 5.5e-07},

	// Anthropic Claude
	"claude-3-7-sonnet": {InputCostPerToken: 3.0e-06, OutputCostPerToken: 1.5e-05, CacheReadCostPerToken: 3.0e-07},
	"claude-3-5-sonnet": {InputCostPerToken: 3.0e-06, OutputCostPerToken: 1.5e-05, CacheReadCostPerToken: 3.0e-07},
	"claude-3-5-haiku":  {InputCostPerToken: 8.0e-07, OutputCostPerToken: 4.0e-06, CacheReadCostPerToken: 8.0e-08},
	"claude-3-opus":     {InputCostPerToken: 1.5e-05, OutputCostPerToken: 7.5e-05, CacheReadCostPerToken: 1.5e-06},
	"claude-3-haiku":    {InputCostPerToken: 2.5e-07, OutputCostPerToken: 1.25e-06, CacheReadCostPerToken: 2.5e-08},

	// Google Gemini
	"gemini-2.5-pro":            {InputCostPerToken: 1.25e-06, OutputCostPerToken: 5.0e-06, CacheReadCostPerToken: 3.125e-07},
	"gemini-2.5-flash":          {InputCostPerToken: 1.5e-07, OutputCostPerToken: 6.0e-07, CacheReadCostPerToken: 3.75e-08},
	"gemini-2.0-flash":          {InputCostPerToken: 1.0e-07, OutputCostPerToken: 4.0e-07, CacheReadCostPerToken: 2.5e-08},
	"gemini-2.0-flash-thinking": {InputCostPerToken: 1.0e-07, OutputCostPerToken: 4.0e-07, CacheReadCostPerToken: 2.5e-08},
	"gemini-1.5-pro":            {InputCostPerToken: 1.25e-06, OutputCostPerToken: 5.0e-06, CacheReadCostPerToken: 3.125e-07},
	"gemini-1.5-flash":          {InputCostPerToken: 7.5e-08, OutputCostPerToken: 3.0e-07, CacheReadCostPerToken: 1.875e-08},

	// DeepSeek
	"deepseek-chat":     {InputCostPerToken: 1.4e-07, OutputCostPerToken: 2.8e-07, CacheReadCostPerToken: 1.4e-08},
	"deepseek-reasoner": {InputCostPerToken: 5.5e-07, OutputCostPerToken: 2.19e-06, CacheReadCostPerToken: 1.4e-07},
	"deepseek-v3":       {InputCostPerToken: 1.4e-07, OutputCostPerToken: 2.8e-07, CacheReadCostPerToken: 1.4e-08},
	"deepseek-r1":       {InputCostPerToken: 5.5e-07, OutputCostPerToken: 2.19e-06, CacheReadCostPerToken: 1.4e-07},

	// Moonshot Kimi
	"kimi-k1.5": {InputCostPerToken: 1.4e-06, OutputCostPerToken: 1.4e-06, CacheReadCostPerToken: 2.8e-07},
	"kimi-k2":   {InputCostPerToken: 1.5e-06, OutputCostPerToken: 2.5e-06, CacheReadCostPerToken: 3.0e-07},

	// Alibaba Qwen
	"qwen-turbo":   {InputCostPerToken: 3.0e-07, OutputCostPerToken: 6.0e-07, CacheReadCostPerToken: 6.0e-08},
	"qwen-plus":    {InputCostPerToken: 8.0e-07, OutputCostPerToken: 2.0e-06, CacheReadCostPerToken: 1.6e-07},
	"qwen-max":     {InputCostPerToken: 2.4e-06, OutputCostPerToken: 9.6e-06, CacheReadCostPerToken: 4.8e-07},
	"qwen-2.5-72b": {InputCostPerToken: 3.5e-07, OutputCostPerToken: 7.0e-07, CacheReadCostPerToken: 7.0e-08},

	// Meta Llama
	"llama-3.3-70b":  {InputCostPerToken: 4.0e-07, OutputCostPerToken: 8.0e-07, CacheReadCostPerToken: 1.0e-07},
	"llama-3.1-405b": {InputCostPerToken: 2.0e-06, OutputCostPerToken: 4.0e-06, CacheReadCostPerToken: 5.0e-07},
	"llama-3.1-70b":  {InputCostPerToken: 4.0e-07, OutputCostPerToken: 8.0e-07, CacheReadCostPerToken: 1.0e-07},
	"llama-3.1-8b":   {InputCostPerToken: 5.0e-08, OutputCostPerToken: 1.0e-07, CacheReadCostPerToken: 1.25e-08},

	// Mistral
	"mistral-large": {InputCostPerToken: 2.0e-06, OutputCostPerToken: 6.0e-06, CacheReadCostPerToken: 5.0e-07},
	"mistral-small": {InputCostPerToken: 2.0e-07, OutputCostPerToken: 6.0e-07, CacheReadCostPerToken: 5.0e-08},
	"codestral":     {InputCostPerToken: 2.0e-07, OutputCostPerToken: 6.0e-07, CacheReadCostPerToken: 5.0e-08},

	// xAI Grok
	"grok-2":           {InputCostPerToken: 2.0e-06, OutputCostPerToken: 1.0e-05, CacheReadCostPerToken: 5.0e-07},
	"grok-beta":        {InputCostPerToken: 5.0e-06, OutputCostPerToken: 1.5e-05, CacheReadCostPerToken: 1.25e-06},
	"grok-vision-beta": {InputCostPerToken: 5.0e-06, OutputCostPerToken: 1.5e-05, CacheReadCostPerToken: 1.25e-06},
}
