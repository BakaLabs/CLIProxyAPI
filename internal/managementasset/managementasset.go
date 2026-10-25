// Package managementasset serves the management control panel (dashboard).
//
// The dashboard is a single self-contained HTML file built from web/ and
// embedded into the binary via the web package; no runtime download is
// involved. The MANAGEMENT_STATIC_PATH environment variable may point at a
// directory or a management.html file on disk to override the embedded asset
// during frontend development.
package managementasset

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v8/web"
)

const managementAssetName = "management.html"

// ManagementFileName exposes the control panel asset filename.
const ManagementFileName = managementAssetName

// DiskOverridePath returns the on-disk panel path configured through the
// MANAGEMENT_STATIC_PATH environment variable. The second return value
// reports whether an override is configured at all.
func DiskOverridePath() (string, bool) {
	override := strings.TrimSpace(os.Getenv("MANAGEMENT_STATIC_PATH"))
	if override == "" {
		return "", false
	}
	cleaned := filepath.Clean(override)
	if strings.EqualFold(filepath.Base(cleaned), managementAssetName) {
		return cleaned, true
	}
	return filepath.Join(cleaned, ManagementFileName), true
}

// EmbeddedHTML returns the single-file dashboard embedded at build time.
func EmbeddedHTML() ([]byte, error) {
	return web.HTML()
}
