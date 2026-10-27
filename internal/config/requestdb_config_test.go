package config

import (
	"testing"
)

func TestParseConfigBytesRequestDBRetentionDays(t *testing.T) {
	tests := []struct {
		name string
		yaml string
		want int
	}{
		{
			name: "defaults to 0 (permanent retention)",
			yaml: "port: 8317\n",
			want: 0,
		},
		{
			name: "legacy layout explicit retention",
			yaml: "request-db-retention-days: 15\n",
			want: 15,
		},
		{
			name: "v8 layout explicit retention",
			yaml: "observability:\n  request-db:\n    retention-days: 60\n",
			want: 60,
		},
		{
			name: "negative value clamps to 0",
			yaml: "observability:\n  request-db:\n    retention-days: -5\n",
			want: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, errParse := ParseConfigBytes([]byte(tt.yaml))
			if errParse != nil {
				t.Fatalf("ParseConfigBytes() error = %v", errParse)
			}
			if cfg.RequestDBRetentionDays != tt.want {
				t.Fatalf("RequestDBRetentionDays = %d, want %d", cfg.RequestDBRetentionDays, tt.want)
			}
		})
	}
}

func TestLoadConfigOptional_RequestDBRetentionDaysDefaultsToZero(t *testing.T) {
	cfg, errLoad := LoadConfigOptional("", true)
	if errLoad != nil {
		t.Fatalf("LoadConfigOptional() error = %v", errLoad)
	}
	if cfg.RequestDBRetentionDays != 0 {
		t.Fatalf("RequestDBRetentionDays = %d, want 0", cfg.RequestDBRetentionDays)
	}
}
