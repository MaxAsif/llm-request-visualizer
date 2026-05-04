import { type Exchange, Sqlite, Storage, type StorageService } from "@llmviz/storage"
import { Context, Effect, Exit, Layer, Scope } from "effect"
import { afterEach, beforeEach, expect, it } from "vitest"
import { createAppRouter } from "../src/server/router.js"

let storage: StorageService
let releaseStorage: () => Promise<unknown>

beforeEach(async () => {
  const scope = await Effect.runPromise(Scope.make())
  const context = await Effect.runPromise(
    Effect.orDie(Scope.extend(Layer.build(Sqlite.layer(":memory:")), scope))
  )
  storage = Context.get(context, Storage)
  releaseStorage = () => Effect.runPromise(Scope.close(scope, Exit.void))
})

afterEach(async () => {
  await releaseStorage()
})

const exchange = (id: string, timestampStart: number, overrides: Partial<Exchange> = {}): Exchange => ({
  id,
  timestamp_start: timestampStart,
  timestamp_end: timestampStart + 10,
  source: "claude-code",
  provider_format: "anthropic",
  http_method: "POST",
  path: "/v1/messages",
  upstream_host: "api.anthropic.com",
  status_code: 200,
  request_headers: { "content-type": "application/json" },
  request_body: new TextEncoder().encode("{}"),
  is_streaming: false,
  response_headers: null,
  response_body: null,
  response_complete: true,
  proxy_error: null,
  ...overrides
})

it("lists exchanges in time order with summary metadata", async () => {
  await Effect.runPromise(storage.writeExchange(exchange("b", 2000)))
  await Effect.runPromise(storage.writeExchange(exchange("a", 1000)))

  const caller = createAppRouter(storage).createCaller({})
  const result = await caller.exchanges.list()

  expect(result.map((e) => e.id)).toEqual(["a", "b"])
  expect(result[0]).toMatchObject({
    source: "claude-code",
    providerFormat: "anthropic",
    httpMethod: "POST",
    path: "/v1/messages",
    statusCode: 200,
    isStreaming: false,
    requestBytes: 2
  })
})

it("filters by source", async () => {
  await Effect.runPromise(storage.writeExchange(exchange("a", 1000)))
  await Effect.runPromise(storage.writeExchange(exchange("b", 2000, { source: "codex", provider_format: "openai" })))

  const caller = createAppRouter(storage).createCaller({})

  expect((await caller.exchanges.list({ source: "codex" })).map((e) => e.id)).toEqual(["b"])
})

const anthropicBody = (texts: ReadonlyArray<string>): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({
      model: "claude-x",
      messages: texts.map((text) => ({ role: "user", content: [{ type: "text", text }] }))
    })
  )

it("groups exchanges into sessions by prefix-matching and splits on the idle timeout", async () => {
  const minute = 60_000
  await Effect.runPromise(
    storage.writeExchange(exchange("a", 0, { request_body: anthropicBody(["one"]) }))
  )
  await Effect.runPromise(
    storage.writeExchange(exchange("b", minute, { request_body: anthropicBody(["one", "two"]) }))
  )
  await Effect.runPromise(
    storage.writeExchange(exchange("c", 90 * minute, { request_body: anthropicBody(["one", "two", "three"]) }))
  )

  const caller = createAppRouter(storage).createCaller({})

  const grouped = await caller.sessions.list({ sort: "oldest" })
  expect(grouped.map((session) => session.exchanges.map((e) => e.id))).toEqual([["a", "b"], ["c"]])
  expect(grouped[0]!.models).toEqual(["claude-x"])
  expect(grouped[0]!.groupedBy).toBe("prefix")

  const merged = await caller.sessions.list({ sort: "oldest", idleTimeoutMinutes: 120 })
  expect(merged.map((session) => session.exchanges.map((e) => e.id))).toEqual([["a", "b", "c"]])

  expect((await caller.sessions.list({ model: "gpt-nope" })).length).toBe(0)
})
