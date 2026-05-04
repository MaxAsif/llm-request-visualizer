import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { defaultConfig } from "./src/server/config.js"

const apiPort = process.env["LLMVIZ_VIEWER_API_PORT"] ?? String(defaultConfig.port)

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/web" },
  server: {
    port: 5317,
    proxy: {
      "/trpc": {
        target: `http://127.0.0.1:${apiPort}`,
        rewrite: (path) => path.replace(/^\/trpc/, "")
      }
    }
  }
})
