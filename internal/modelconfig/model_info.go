package modelconfig

import (
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/thinking"
)

// ResolveModelInfo returns a private static capability snapshot for a model name.
// Static capabilities come from the suffix-free upstream name. Thinking passes
// through from the client request without validation, so no thinking capability
// is attached here.
func ResolveModelInfo(name, modelType string) *registry.ModelInfo {
	trimmedName := strings.TrimSpace(name)
	baseName := strings.TrimSpace(thinking.ParseSuffix(trimmedName).ModelName)
	info := registry.LookupStaticModelInfo(baseName)
	if info == nil {
		info = &registry.ModelInfo{}
	}
	info.ID = trimmedName
	info.Type = strings.TrimSpace(modelType)
	info.UserDefined = false
	return info
}
