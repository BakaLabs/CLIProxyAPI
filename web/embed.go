// Package web embeds the management dashboard frontend.
//
// The dashboard is built by pnpm (pnpm -C web build) into a single
// self-contained HTML file at web/dist/index.html; see ../vite.config.ts.
// A placeholder index.html is committed so that plain `go build` always
// works; release builds replace it via the frontend build step.
package web

import "embed"

//go:embed all:dist
var dist embed.FS

// HTML returns the built single-file dashboard (dist/index.html).
func HTML() ([]byte, error) {
	return dist.ReadFile("dist/index.html")
}
