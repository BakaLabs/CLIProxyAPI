package pricing

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"
)

const (
	// refreshInterval is how often prices are re-checked in the background.
	refreshInterval = 24 * time.Hour
)

// Manager coordinates model pricing lookup, caching, and background refreshing.
type Manager struct {
	mu        sync.RWMutex
	prices    map[string]ModelPrice
	cachePath string
}

var (
	globalManager *Manager
	once          sync.Once
)

// Global returns the global pricing manager singleton.
func Global() *Manager {
	once.Do(func() {
		globalManager = NewManager("")
	})
	return globalManager
}

// NewManager creates a Manager instance initialized with default seed prices.
func NewManager(cachePath string) *Manager {
	initial := make(map[string]ModelPrice, len(defaultPrices)+500)
	for k, v := range defaultPrices {
		initial[k] = v
	}

	m := &Manager{
		prices:    initial,
		cachePath: cachePath,
	}

	// If a cache file exists, load it
	if cachePath != "" {
		m.loadCache(cachePath)
	}

	return m
}

// SetCachePath updates the disk cache path and loads existing cached prices if present.
func (m *Manager) SetCachePath(path string) {
	m.mu.Lock()
	m.cachePath = path
	m.mu.Unlock()

	if path != "" {
		m.loadCache(path)
	}
}

// GetPrice looks up the per-token price for the given model name using smart normalization.
func (m *Manager) GetPrice(model string) (ModelPrice, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return FindPrice(m.prices, model)
}

// GetAllPrices returns a copy of all loaded model prices.
func (m *Manager) GetAllPrices() map[string]ModelPrice {
	m.mu.RLock()
	defer m.mu.RUnlock()

	copyMap := make(map[string]ModelPrice, len(m.prices))
	for k, v := range m.prices {
		copyMap[k] = v
	}
	return copyMap
}

// CalculateCost computes total estimated USD cost for token usage on a model.
func (m *Manager) CalculateCost(model string, inputTokens, outputTokens, cacheReadTokens int64) float64 {
	price, ok := m.GetPrice(model)
	if !ok {
		return 0.0
	}

	uncachedInput := inputTokens
	if cacheReadTokens > 0 && uncachedInput >= cacheReadTokens {
		uncachedInput -= cacheReadTokens
	}

	cost := float64(uncachedInput)*price.InputCostPerToken +
		float64(outputTokens)*price.OutputCostPerToken +
		float64(cacheReadTokens)*price.CacheReadCostPerToken

	return cost
}

// CalculateCost is a package-level helper that delegates to Global().
func CalculateCost(model string, inputTokens, outputTokens, cacheReadTokens int64) float64 {
	return Global().CalculateCost(model, inputTokens, outputTokens, cacheReadTokens)
}

// StartBackgroundUpdater starts an asynchronous worker that refreshes prices on startup
// and periodically every 24 hours.
func (m *Manager) StartBackgroundUpdater(ctx context.Context) {
	go func() {
		// Run initial fetch slightly deferred (2 seconds after start) so startup is instant
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
			m.refresh(ctx)
		}

		ticker := time.NewTicker(refreshInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.refresh(ctx)
			}
		}
	}()
}

func (m *Manager) refresh(ctx context.Context) {
	log.Info("pricing: starting background model price refresh...")
	remote := FetchRemotePrices(ctx)
	if len(remote) == 0 {
		log.Warn("pricing: remote fetch returned no prices, retaining existing catalog")
		return
	}

	m.mu.Lock()
	for k, v := range remote {
		m.prices[k] = v
	}
	// Re-apply default seed prices to make sure our canonical base definitions are preserved
	for k, v := range defaultPrices {
		if _, exists := m.prices[k]; !exists {
			m.prices[k] = v
		}
	}
	cachePath := m.cachePath
	snapshot := make(map[string]ModelPrice, len(m.prices))
	for k, v := range m.prices {
		snapshot[k] = v
	}
	m.mu.Unlock()

	log.Infof("pricing: successfully updated price catalog, total models: %d", len(snapshot))

	if cachePath != "" {
		if err := saveCache(cachePath, snapshot); err != nil {
			log.WithError(err).Warn("pricing: failed to save price cache file")
		} else {
			log.Infof("pricing: saved price cache to %s", cachePath)
		}
	}
}

func (m *Manager) loadCache(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.WithError(err).Warn("pricing: failed to read price cache file")
		}
		return
	}

	var cached map[string]ModelPrice
	if err := json.Unmarshal(data, &cached); err != nil {
		log.WithError(err).Warn("pricing: failed to parse cached prices")
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	for k, v := range cached {
		m.prices[k] = v
	}
	// Re-verify defaults
	for k, v := range defaultPrices {
		if _, exists := m.prices[k]; !exists {
			m.prices[k] = v
		}
	}
	log.Infof("pricing: loaded %d model prices from local cache (%s)", len(cached), path)
}

func saveCache(path string, prices map[string]ModelPrice) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(prices, "", "  ")
	if err != nil {
		return err
	}

	tmpFile := path + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpFile, path)
}
