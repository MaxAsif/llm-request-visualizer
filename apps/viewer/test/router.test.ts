import { type Chunk, type Exchange, Sqlite, Storage, type StorageService } from "@llmviz/storage"
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

it("returns a session's exchanges chronologically with each one diffed against the previous", async () => {
  const minute = 60_000
  await Effect.runPromise(
    storage.writeExchange(exchange("a", 0, { request_body: anthropicBody(["one"]) }))
  )
  await Effect.runPromise(
    storage.writeExchange(exchange("b", minute, { request_body: anthropicBody(["one", "two"]) }))
  )
  await Effect.runPromise(
    storage.writeExchange(exchange("c", 2 * minute, { request_body: anthropicBody(["one", "two", "three"]) }))
  )

  const caller = createAppRouter(storage).createCaller({})
  const session = await caller.sessions.get({ id: "a" })

  expect(session.exchanges.map((e) => e.summary.id)).toEqual(["a", "b", "c"])
  expect(session.exchanges[0]!.diff).toBeNull()
  expect(session.exchanges[0]!.canonical.messages.length).toBe(1)

  expect(session.exchanges[1]!.diff).toMatchObject({
    unchangedMessages: 1,
    diverged: false,
    systemPromptChanged: false
  })
  expect(session.exchanges[1]!.diff!.newMessages.map((m) => m.content[0])).toEqual([
    { type: "text", text: "two" }
  ])
  expect(session.exchanges[2]!.diff!.unchangedMessages).toBe(2)
  expect(session.exchanges[2]!.diff!.newMessages.length).toBe(1)

  expect(session.exchanges[1]!.raw.requestBody).toContain('"two"')

  await expect(caller.sessions.get({ id: "missing" })).rejects.toThrow(/no session with id/)
})

const sseChunks = (exchangeId: string, events: ReadonlyArray<string>): ReadonlyArray<Chunk> =>
  events.map((event, index) => ({
    id: `${exchangeId}-${index}`,
    exchange_id: exchangeId,
    sequence: index,
    timestamp: 1000 + index,
    raw_data: new TextEncoder().encode(`data: ${event}\n\n`)
  }))

it("returns canonical and raw payloads for a single exchange", async () => {
  const requestBody = new TextEncoder().encode(
    JSON.stringify({
      model: "claude-opus-5",
      system: "be brief",
      messages: [{ role: "user", content: "hi" }]
    })
  )
  const responseBody = new TextEncoder().encode(
    JSON.stringify({
      model: "claude-opus-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "hello" }],
      usage: { input_tokens: 3, output_tokens: 1 }
    })
  )
  await Effect.runPromise(
    storage.writeExchange(
      exchange("solo", 1000, {
        request_body: requestBody,
        response_headers: { "content-type": "application/json" },
        response_body: responseBody
      })
    )
  )

  const caller = createAppRouter(storage).createCaller({})
  const detail = await caller.exchanges.get({ id: "solo" })

  expect(detail.summary.id).toBe("solo")
  expect(detail.canonical.model).toBe("claude-opus-5")
  expect(detail.canonical.systemPrompt).toBe("be brief")
  expect(detail.canonical.responseText).toBe("hello")
  expect(detail.canonical.stopReason).toBe("end_turn")
  expect(detail.canonical.usage).toMatchObject({ input_tokens: 3, output_tokens: 1 })
  expect(detail.raw.requestHeaders).toEqual({ "content-type": "application/json" })
  expect(JSON.parse(detail.raw.requestBody).system).toBe("be brief")
  expect(detail.raw.responseHeaders).toEqual({ "content-type": "application/json" })
  expect(JSON.parse(detail.raw.responseBody!).stop_reason).toBe("end_turn")

  await expect(caller.exchanges.get({ id: "missing" })).rejects.toThrow(/no exchange with id/)
})

it("returns the raw chunk stream and canonical reconstruction for a streaming exchange", async () => {
  const chunks = sseChunks("stream", [
    JSON.stringify({ type: "message_start", message: { model: "claude-opus-5", usage: { input_tokens: 5 } } }),
    JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "par" } }),
    JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "tial" } }),
    JSON.stringify({ type: "content_block_stop", index: 0 }),
    JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } })
  ])

  await Effect.runPromise(
    storage.writeExchange(
      exchange("stream", 1000, {
        is_streaming: true,
        request_body: new TextEncoder().encode(JSON.stringify({ model: "claude-opus-5", stream: true, messages: [] })),
        response_headers: { "content-type": "text/event-stream" }
      })
    )
  )
  for (const chunk of chunks) await Effect.runPromise(storage.appendChunk(chunk))

  const caller = createAppRouter(storage).createCaller({})

  const detail = await caller.exchanges.get({ id: "stream" })
  expect(detail.summary.isStreaming).toBe(true)
  expect(detail.canonical.responseText).toBe("partial")
  expect(detail.canonical.stopReason).toBe("end_turn")
  expect(detail.canonical.usage).toMatchObject({ input_tokens: 5, output_tokens: 2 })

  const stream = await caller.exchanges.chunks({ id: "stream" })
  expect(stream.map((chunk) => chunk.sequence)).toEqual([0, 1, 2, 3, 4, 5])
  expect(stream[0]!.timestamp).toBe(1000)
  expect(stream[2]!.data).toContain('"text_delta"')

  expect(await caller.exchanges.chunks({ id: "solo" })).toEqual([])
})
