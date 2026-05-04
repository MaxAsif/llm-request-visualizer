import { describe, expect, it } from "vitest"
import {
  ConfigError,
  DEFAULT_REDACTED_HEADERS,
  defaultConfig,
  parseArgv,
  resolveConfig
} from "../src/config.js"

const file = JSON.stringify({
  port: 9001,
  upstreams: { openai: "http://file-openai" },
  storageBackend: "jsonl",
  jsonlDirectory: "file-logs",
  redactHeaders: false
})

describe("precedence", () => {
  it("falls back to built-in defaults", () => {
    expect(resolveConfig(undefined, {}, [])).toEqual(defaultConfig)
  })

  it("applies the config file over defaults", () => {
    const config = resolveConfig(file, {}, [])
    expect(config.port).toBe(9001)
    expect(config.storageBackend).toBe("jsonl")
    expect(config.jsonlDirectory).toBe("file-logs")
    expect(config.redactHeaders).toBe(false)
    expect(config.upstreams.openai).toBe("http://file-openai")
    expect(config.upstreams.anthropic).toBe(defaultConfig.upstreams.anthropic)
    expect(config.redactedHeaders).toEqual(DEFAULT_REDACTED_HEADERS)
  })

  it("applies env vars over the config file", () => {
    const config = resolveConfig(file, { LLMVIZ_PORT: "9002", LLMVIZ_STORAGE: "sqlite" }, [])
    expect(config.port).toBe(9002)
    expect(config.storageBackend).toBe("sqlite")
    expect(config.jsonlDirectory).toBe("file-logs")
  })

  it("applies CLI flags over env vars and the config file", () => {
    const config = resolveConfig(file, { LLMVIZ_PORT: "9002", LLMVIZ_REDACT: "true" }, [
      "--port",
      "9003",
      "--no-redact"
    ])
    expect(config.port).toBe(9003)
    expect(config.redactHeaders).toBe(false)
  })

  it("merges upstreams across every layer instead of replacing the map", () => {
    const config = resolveConfig(file, { LLMVIZ_UPSTREAM_ANTHROPIC: "http://env-anthropic" }, [
      "--upstream-openai=http://cli-openai"
    ])
    expect(config.upstreams).toEqual({
      anthropic: "http://env-anthropic",
      openai: "http://cli-openai"
    })
  })
})

describe("parsing", () => {
  it("accepts both --flag value and --flag=value", () => {
    expect(parseArgv(["--db", "a.db"]).overrides.databasePath).toBe("a.db")
    expect(parseArgv(["--db=b.db"]).overrides.databasePath).toBe("b.db")
  })

  it("extracts the config path without treating it as an override", () => {
    const parsed = parseArgv(["--config", "custom.json", "--port=1"])
    expect(parsed.configPath).toBe("custom.json")
    expect(parsed.overrides).toEqual({ port: 1 })
  })

  it("normalises redacted header names to lowercase", () => {
    const config = resolveConfig(undefined, { LLMVIZ_REDACTED_HEADERS: "X-Token, Cookie" }, [])
    expect(config.redactedHeaders).toEqual(["x-token", "cookie"])
  })

  it("rejects unknown flags and invalid values", () => {
    expect(() => parseArgv(["--nope"])).toThrow(ConfigError)
    expect(() => parseArgv(["--port", "abc"])).toThrow(ConfigError)
    expect(() => parseArgv(["--storage", "redis"])).toThrow(ConfigError)
    expect(() => parseArgv(["--db"])).toThrow(ConfigError)
    expect(() => resolveConfig("not json", {}, [])).toThrow(ConfigError)
    expect(() => resolveConfig(JSON.stringify({ port: "abc" }), {}, [])).toThrow(ConfigError)
  })
})
