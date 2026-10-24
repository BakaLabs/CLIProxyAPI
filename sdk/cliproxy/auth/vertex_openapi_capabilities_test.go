package auth

import (
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

// Vertex API-key configured models pass thinking through without validation:
// their capability routes carry no thinking declaration and are user-defined.
func TestCompileVertexAPIKeyOpenAPICapabilities(t *testing.T) {
	enabled, disabled := true, false
	for _, tc := range []struct {
		name       string
		model      string
		credential *bool
		setting    *bool
	}{
		{name: "automatic partner", model: "partner/custom-model"},
		{name: "resource model", model: "publishers/partner/models/custom-model"},
		{name: "credential opt-in", model: "custom-model", credential: &enabled},
		{name: "credential opt-out", model: "partner/custom-model", credential: &disabled},
		{name: "model opt-in", model: "custom-model", credential: &disabled, setting: &enabled},
		{name: "model opt-out", model: "partner/custom-model", credential: &enabled, setting: &disabled},
		{name: "google prefix", model: "google/custom-model"},
		{name: "catalog model", model: "gemini-2.5-pro", credential: &enabled},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := &config.Config{VertexCompatAPIKey: []config.VertexCompatKey{{
				APIKey: "test-key", OpenAPI: tc.credential,
				Models: []config.VertexCompatModel{{Name: tc.model, Alias: "public-model", OpenAPI: tc.setting}},
			}}}
			auth := &Auth{Provider: "vertex", Attributes: map[string]string{AttributeAPIKey: "test-key", AttributeSource: "config:vertex-apikey[test]"}}
			capabilities := compileAPIKeyModelCapabilitiesForAuth(cfg, auth)
			routes := capabilities["public-model"]
			if len(routes) != 1 || routes[0].modelInfo == nil {
				t.Fatalf("capability routes = %+v", routes)
			}
			info := routes[0].modelInfo
			if !info.UserDefined {
				t.Fatalf("UserDefined = false, want passthrough capability for %q", tc.model)
			}
			if info.Thinking != nil {
				t.Fatalf("Thinking = %+v, want nil for configured passthrough model", info.Thinking)
			}
		})
	}
}
