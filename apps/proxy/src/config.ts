import { readFileSync } from "node:fs"
import type { ProviderFormat } from "@llmviz/storage"

export type StorageBackend = "sqlite" | "jsonl"

export interface ProxyConfig {
  readonly host: string
  readonly port: number
  readonly upstreams: Record<ProviderFormat, string>
  readonly storageBackend: StorageBackend
  readonly databasePath: string
  readonly jsonlDirectory: string
  readonly redactHeaders: boolean
  readonly redactedHeaders: ReadonlyArray<string>
}

export const DEFAULT_REDACTED_HEADERS: ReadonlyArray<string> = [
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "anthropic-api-key",
  "openai-api-key",
  "x-goog-api-key",
  "x-auth-token",
  "cookie"
]

export const defaultConfig: ProxyConfig = {
  host: "127.0.0.1",
  port: 8317,
  upstreams: {
    anthropic: "https://api.anthropic.com",
    openai: "https://api.openai.com"
  },
  storageBackend: "sqlite",
  databasePath: "llmviz.db",
  jsonlDirectory: "llmviz-logs",
  redactHeaders: true,
  redactedHeaders: DEFAULT_REDACTED_HEADERS
}

export const DEFAULT_CONFIG_FILE = "llmviz.config.json"

export interface ConfigOverrides {
  readonly host?: string
  readonly port?: number
  readonly upstreams?: Partial<Record<ProviderFormat, string>>
  readonly storageBackend?: StorageBackend
  readonly databasePath?: string
  readonly jsonlDirectory?: string
  readonly redactHeaders?: boolean
  readonly redactedHeaders?: ReadonlyArray<string>
}

export class ConfigError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asString = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new ConfigError(`${field} must be a string`)
  return value
}

const asPort = (value: unknown, field: string): number => {
  const port = typeof value === "string" ? Number(value) : value
  if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`${field} must be a port number between 0 and 65535`)
  }
  return port
}

const asBackend = (value: unknown, field: string): StorageBackend => {
  if (value !== "sqlite" && value !== "jsonl") {
    throw new ConfigError(`${field} must be either "sqlite" or "jsonl"`)
  }
  return value
}

const asBoolean = (value: unknown, field: string): boolean => {
  if (typeof value === "boolean") return value
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
  throw new ConfigError(`${field} must be a boolean`)
}

const asHeaderList = (value: unknown, field: string): ReadonlyArray<string> => {
  const raw = typeof value === "string" ? value.split(",") : value
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
    throw new ConfigError(`${field} must be a list of header names`)
  }
  return (raw as ReadonlyArray<string>).map((entry) => entry.trim().toLowerCase()).filter(
    (entry) => entry.length > 0
  )
}

export const parseConfigFile = (contents: string): ConfigOverrides => {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch (cause) {
    throw new ConfigError(`config file is not valid JSON: ${(cause as Error).message}`)
  }
  if (!isRecord(parsed)) throw new ConfigError("config file must contain a JSON object")

  const overrides: {
    -readonly [K in keyof ConfigOverrides]: ConfigOverrides[K]
  } = {}

  if (parsed["host"] !== undefined) overrides.host = asString(parsed["host"], "host")
  if (parsed["port"] !== undefined) overrides.port = asPort(parsed["port"], "port")
  if (parsed["upstreams"] !== undefined) {
    const upstreams = parsed["upstreams"]
    if (!isRecord(upstreams)) throw new ConfigError("upstreams must be an object")
    const merged: Partial<Record<ProviderFormat, string>> = {}
    if (upstreams["anthropic"] !== undefined) {
      merged.anthropic = asString(upstreams["anthropic"], "upstreams.anthropic")
    }
    if (upstreams["openai"] !== undefined) {
      merged.openai = asString(upstreams["openai"], "upstreams.openai")
    }
    overrides.upstreams = merged
  }
  if (parsed["storageBackend"] !== undefined) {
    overrides.storageBackend = asBackend(parsed["storageBackend"], "storageBackend")
  }
  if (parsed["databasePath"] !== undefined) {
    overrides.databasePath = asString(parsed["databasePath"], "databasePath")
  }
  if (parsed["jsonlDirectory"] !== undefined) {
    overrides.jsonlDirectory = asString(parsed["jsonlDirectory"], "jsonlDirectory")
  }
  if (parsed["redactHeaders"] !== undefined) {
    overrides.redactHeaders = asBoolean(parsed["redactHeaders"], "redactHeaders")
  }
  if (parsed["redactedHeaders"] !== undefined) {
    overrides.redactedHeaders = asHeaderList(parsed["redactedHeaders"], "redactedHeaders")
  }

  return overrides
}

export const overridesFromEnv = (env: NodeJS.ProcessEnv): ConfigOverrides => {
  const overrides: { -readonly [K in keyof ConfigOverrides]: ConfigOverrides[K] } = {}

  if (env["LLMVIZ_HOST"] !== undefined) overrides.host = env["LLMVIZ_HOST"]
  if (env["LLMVIZ_PORT"] !== undefined) overrides.port = asPort(env["LLMVIZ_PORT"], "LLMVIZ_PORT")
  const anthropic = env["LLMVIZ_UPSTREAM_ANTHROPIC"]
  const openai = env["LLMVIZ_UPSTREAM_OPENAI"]
  if (anthropic !== undefined || openai !== undefined) {
    overrides.upstreams = {
      ...(anthropic === undefined ? {} : { anthropic }),
      ...(openai === undefined ? {} : { openai })
    }
  }
  if (env["LLMVIZ_STORAGE"] !== undefined) {
    overrides.storageBackend = asBackend(env["LLMVIZ_STORAGE"], "LLMVIZ_STORAGE")
  }
  if (env["LLMVIZ_DB"] !== undefined) overrides.databasePath = env["LLMVIZ_DB"]
  if (env["LLMVIZ_JSONL_DIR"] !== undefined) overrides.jsonlDirectory = env["LLMVIZ_JSONL_DIR"]
  if (env["LLMVIZ_REDACT"] !== undefined) {
    overrides.redactHeaders = asBoolean(env["LLMVIZ_REDACT"], "LLMVIZ_REDACT")
  }
  if (env["LLMVIZ_REDACTED_HEADERS"] !== undefined) {
    overrides.redactedHeaders = asHeaderList(
      env["LLMVIZ_REDACTED_HEADERS"],
      "LLMVIZ_REDACTED_HEADERS"
    )
  }

  return overrides
}

interface ParsedArgv {
  readonly configPath: string | undefined
  readonly overrides: ConfigOverrides
}

export const parseArgv = (argv: ReadonlyArray<string>): ParsedArgv => {
  const overrides: { -readonly [K in keyof ConfigOverrides]: ConfigOverrides[K] } = {}
  let configPath: string | undefined
  let index = 0

  const value = (flag: string): string => {
    const next = argv[index + 1]
    if (next === undefined) throw new ConfigError(`${flag} requires a value`)
    index++
    return next
  }

  const upstream = (format: ProviderFormat, url: string): void => {
    overrides.upstreams = { ...overrides.upstreams, [format]: url }
  }

  for (; index < argv.length; index++) {
    const arg = argv[index]!
    const equals = arg.indexOf("=")
    const flag = arg.startsWith("--") && equals !== -1 ? arg.slice(0, equals) : arg
    const inline = arg.startsWith("--") && equals !== -1 ? arg.slice(equals + 1) : undefined
    const take = (): string => inline ?? value(flag)

    switch (flag) {
      case "--config":
        configPath = take()
        break
      case "--host":
        overrides.host = take()
        break
      case "--port":
        overrides.port = asPort(take(), "--port")
        break
      case "--upstream-anthropic":
        upstream("anthropic", take())
        break
      case "--upstream-openai":
        upstream("openai", take())
        break
      case "--storage":
        overrides.storageBackend = asBackend(take(), "--storage")
        break
      case "--db":
        overrides.databasePath = take()
        break
      case "--jsonl-dir":
        overrides.jsonlDirectory = take()
        break
      case "--redact":
        overrides.redactHeaders = true
        break
      case "--no-redact":
        overrides.redactHeaders = false
        break
      case "--redacted-headers":
        overrides.redactedHeaders = asHeaderList(take(), "--redacted-headers")
        break
      default:
        throw new ConfigError(`unknown option ${flag}`)
    }
  }

  return { configPath, overrides }
}

const apply = (base: ProxyConfig, overrides: ConfigOverrides): ProxyConfig => ({
  ...base,
  ...overrides,
  upstreams: { ...base.upstreams, ...overrides.upstreams }
})

/** Precedence, lowest to highest: built-in defaults, config file, environment, CLI flags. */
export const resolveConfig = (
  fileContents: string | undefined,
  env: NodeJS.ProcessEnv,
  argv: ReadonlyArray<string>
): ProxyConfig => {
  const cli = parseArgv(argv)
  const file = fileContents === undefined ? {} : parseConfigFile(fileContents)
  return [file, overridesFromEnv(env), cli.overrides].reduce(apply, defaultConfig)
}

export const loadConfig = (
  env: NodeJS.ProcessEnv = process.env,
  argv: ReadonlyArray<string> = process.argv.slice(2)
): ProxyConfig => {
  const requested = parseArgv(argv).configPath ?? env["LLMVIZ_CONFIG"]
  const path = requested ?? DEFAULT_CONFIG_FILE

  let contents: string | undefined
  try {
    contents = readFileSync(path, "utf8")
  } catch (cause) {
    // An explicitly requested config file must exist; the default one is optional.
    if (requested !== undefined) {
      throw new ConfigError(`cannot read config file ${path}: ${(cause as Error).message}`)
    }
  }

  return resolveConfig(contents, env, argv)
}
