import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { defaultConfig } from "./src/server/config.js"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const apiPort = env["LLMVIZ_VIEWER_API_PORT"] ?? String(defaultConfig.port)
  const allowedHosts = (env["LLMVIZ_VIEWER_ALLOWED_HOSTS"] ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0)

  return {
    plugins: [react()],
    build: { outDir: "dist/web" },
    server: {
      port: 5317,
      allowedHosts: allowedHosts.length === 0 ? undefined : allowedHosts,
      proxy: {
        "/trpc": {
          target: `http://127.0.0.1:${apiPort}`,
          rewrite: (path) => path.replace(/^\/trpc/, "")
        }
      }
    }
  }
})
