import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The dashboard is embedded into the Go binary as one self-contained HTML
// file (see web/embed.go), so every asset must be inlined at build time.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile({ removeViteModuleLoader: true })],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    target: "es2020",
    outDir: "dist",
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
  server: {
    port: 5177,
    proxy: {
      "/v0/management": "http://localhost:8317",
      "/v8/management": "http://localhost:8317",
      "/v1": "http://localhost:8317",
    },
  },
});
