package cliproxy

import (
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func TestBuildVertexCompatConfigModels_OpenAPICapabilities(t *testing.T) {
	enabled, disabled := true, false
	for _, tc := range []struct {
		name       string
		model      string
		credential *bool
		setting    *bool
		ownedBy    string
	}{
		{name: "automatic partner", model: "deepseek-ai/custom-model", ownedBy: "deepseek-ai"},
		{name: "credential opt-in", model: "custom-model", credential: &enabled, ownedBy: "google"},
		{name: "credential opt-out", model: "partner/model", credential: &disabled, ownedBy: "partner"},
		{name: "model opt-in", model: "custom-model", credential: &disabled, setting: &enabled, ownedBy: "google"},
		{name: "model opt-out", model: "partner/model", credential: &enabled, setting: &disabled, ownedBy: "partner"},
		{name: "google prefix", model: "GoOgLe/custom-model", ownedBy: "google"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			models := buildVertexCompatConfigModels(&config.VertexCompatKey{OpenAPI: tc.credential, Models: []config.VertexCompatModel{
				{},
				{Name: tc.model, Alias: "public-model", OpenAPI: tc.setting},
				{Name: "ignored/duplicate", Alias: "public-model", OpenAPI: &enabled},
			}})
			if len(models) != 1 {
				t.Fatalf("models = %+v, want exactly one model", models)
			}
			info := models[0]
			if info.OwnedBy != tc.ownedBy {
				t.Fatalf("OwnedBy = %q, want %q", info.OwnedBy, tc.ownedBy)
			}
		})
	}
	if models := buildVertexCompatConfigModels(nil); models != nil {
		t.Fatalf("nil entry models = %v", models)
	}
}
