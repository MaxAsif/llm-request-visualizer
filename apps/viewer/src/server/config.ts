export interface ViewerConfig {
  readonly host: string
  readonly port: number
  readonly databasePath: string
}

export const defaultConfig: ViewerConfig = {
  host: "127.0.0.1",
  port: 8318,
  databasePath: "llmviz.db"
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ViewerConfig => ({
  host: env["LLMVIZ_VIEWER_HOST"] ?? defaultConfig.host,
  port:
    env["LLMVIZ_VIEWER_API_PORT"] === undefined
      ? defaultConfig.port
      : Number(env["LLMVIZ_VIEWER_API_PORT"]),
  databasePath: env["LLMVIZ_DB"] ?? defaultConfig.databasePath
})
