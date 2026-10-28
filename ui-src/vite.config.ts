import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Builds into ../ui, which the engine serves and the app bundles.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: { outDir: "../ui", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: { proxy: { "/status": "http://127.0.0.1:7861", "/jobs": "http://127.0.0.1:7861", "/images": "http://127.0.0.1:7861", "/downloads": "http://127.0.0.1:7861" } },
})
