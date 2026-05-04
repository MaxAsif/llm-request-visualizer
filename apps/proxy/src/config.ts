import type { ProviderFormat } from "@llmviz/storage"

export interface ProxyConfig {
  readonly host: string
  readonly port: number
  readonly upstreams: Record<ProviderFormat, string>
  readonly databasePath: string
}

export const defaultConfig: ProxyConfig = {
  host: "127.0.0.1",
  port: 8317,
  upstreams: {
    anthropic: "https://api.anthropic.com",
    openai: "https://api.openai.com"
  },
  databasePath: "llmviz.db"
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ProxyConfig => ({
  host: defaultConfig.host,
  port: env["LLMVIZ_PORT"] === undefined ? defaultConfig.port : Number(env["LLMVIZ_PORT"]),
  upstreams: {
    anthropic: env["LLMVIZ_UPSTREAM_ANTHROPIC"] ?? defaultConfig.upstreams.anthropic,
    openai: env["LLMVIZ_UPSTREAM_OPENAI"] ?? defaultConfig.upstreams.openai
  },
  databasePath: env["LLMVIZ_DB"] ?? defaultConfig.databasePath
})
