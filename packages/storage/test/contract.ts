import { Effect, Layer, Option } from "effect"
import { describe, expect, it } from "vitest"
import type { Chunk, Exchange } from "../src/model.js"
import { Storage, type StorageError } from "../src/port.js"

const encode = (text: string) => new TextEncoder().encode(text)

export const nonStreamingExchange: Exchange = {
  id: "exch-1",
  timestamp_start: 1_700_000_000_000,
  timestamp_end: 1_700_000_001_500,
  source: "claude-code",
  provider_format: "anthropic",
  http_method: "POST",
  path: "/v1/messages",
  upstream_host: "api.anthropic.com",
  status_code: 200,
  request_headers: { "content-type": "application/json", "x-api-key": "[REDACTED]" },
  request_body: encode(JSON.stringify({ model: "claude-sonnet-5", messages: [] })),
  is_streaming: false,
  response_headers: { "content-type": "application/json" },
  response_body: encode(JSON.stringify({ id: "msg_1", content: [] })),
  response_complete: true,
  proxy_error: null
}

export const streamingExchange: Exchange = {
  id: "exch-2",
  timestamp_start: 1_700_000_010_000,
  timestamp_end: null,
  source: "codex",
  provider_format: "openai",
  http_method: "POST",
  path: "/v1/responses",
  upstream_host: "api.openai.com",
  status_code: null,
  request_headers: { authorization: "[REDACTED]" },
  request_body: encode("{}"),
  is_streaming: true,
  response_headers: null,
  response_body: null,
  response_complete: false,
  proxy_error: null
}

export const streamingChunks: ReadonlyArray<Chunk> = [
  {
    id: "chunk-a",
    exchange_id: "exch-2",
    sequence: 0,
    timestamp: 1_700_000_010_100,
    raw_data: encode("event: response.created\ndata: {}\n\n")
  },
  {
    id: "chunk-b",
    exchange_id: "exch-2",
    sequence: 1,
    timestamp: 1_700_000_010_200,
    raw_data: encode("event: response.output_text.delta\ndata: {\"delta\":\"hi\"}\n\n")
  },
  {
    id: "chunk-c",
    exchange_id: "exch-2",
    sequence: 2,
    timestamp: 1_700_000_010_300,
    raw_data: encode("event: response.completed\ndata: {}\n\n")
  }
]

/**
 * Behavioral contract every storage adapter must satisfy. Shared across adapters so
 * SQLite and JSONL are held to the same observable behavior, not the same internals.
 */
export const testStorageContract = (
  name: string,
  makeLayer: () => Layer.Layer<Storage, StorageError>
) => {
  const run = <A>(effect: Effect.Effect<A, StorageError, Storage>) =>
    Effect.runPromise(Effect.scoped(Effect.provide(effect, makeLayer())))

  describe(`storage contract: ${name}`, () => {
    it("round-trips a non-streaming exchange unchanged", async () => {
      const result = await run(
        Effect.gen(function* () {
          const storage = yield* Storage
          yield* storage.writeExchange(nonStreamingExchange)
          return yield* storage.getExchange(nonStreamingExchange.id)
        })
      )
      expect(result).toStrictEqual(Option.some(nonStreamingExchange))
    })

    it("returns none for an unknown exchange id", async () => {
      const result = await run(
        Effect.gen(function* () {
          const storage = yield* Storage
          return yield* storage.getExchange("does-not-exist")
        })
      )
      expect(result).toStrictEqual(Option.none())
    })

    it("returns chunks ordered by sequence regardless of append order", async () => {
      const chunks = await run(
        Effect.gen(function* () {
          const storage = yield* Storage
          yield* storage.writeExchange(streamingExchange)
          const [first, second, third] = streamingChunks
          yield* storage.appendChunk(second!)
          yield* storage.appendChunk(third!)
          yield* storage.appendChunk(first!)
          return yield* storage.getChunks(streamingExchange.id)
        })
      )
      expect(chunks).toStrictEqual(streamingChunks)
    })

    it("scopes chunks to their own exchange", async () => {
      const chunks = await run(
        Effect.gen(function* () {
          const storage = yield* Storage
          yield* storage.writeExchange(nonStreamingExchange)
          yield* storage.writeExchange(streamingExchange)
          yield* Effect.forEach(streamingChunks, (chunk) => storage.appendChunk(chunk))
          return yield* storage.getChunks(nonStreamingExchange.id)
        })
      )
      expect(chunks).toStrictEqual([])
    })

    it("upserts an exchange written twice under the same id", async () => {
      const completed: Exchange = {
        ...streamingExchange,
        timestamp_end: 1_700_000_012_000,
        status_code: 200,
        response_headers: { "content-type": "text/event-stream" },
        response_complete: true
      }
      const result = await run(
        Effect.gen(function* () {
          const storage = yield* Storage
          yield* storage.writeExchange(streamingExchange)
          yield* storage.writeExchange(completed)
          const one = yield* storage.getExchange(streamingExchange.id)
          const all = yield* storage.listExchanges()
          return { one, count: all.length }
        })
      )
      expect(result.one).toStrictEqual(Option.some(completed))
      expect(result.count).toBe(1)
    })

    it("lists exchanges in chronological order and honours filters", async () => {
      const result = await run(
        Effect.gen(function* () {
          const storage = yield* Storage
          yield* storage.writeExchange(streamingExchange)
          yield* storage.writeExchange(nonStreamingExchange)
          const all = yield* storage.listExchanges()
          const bySource = yield* storage.listExchanges({ source: "codex" })
          const limited = yield* storage.listExchanges({ limit: 1, offset: 1 })
          return { all, bySource, limited }
        })
      )
      expect(result.all).toStrictEqual([nonStreamingExchange, streamingExchange])
      expect(result.bySource).toStrictEqual([streamingExchange])
      expect(result.limited).toStrictEqual([streamingExchange])
    })

    it("records a proxy error distinctly from an upstream status", async () => {
      const failed: Exchange = {
        ...nonStreamingExchange,
        id: "exch-3",
        status_code: null,
        response_headers: null,
        response_body: null,
        response_complete: false,
        proxy_error: "ECONNREFUSED api.anthropic.com:443"
      }
      const result = await run(
        Effect.gen(function* () {
          const storage = yield* Storage
          yield* storage.writeExchange(failed)
          return yield* storage.getExchange(failed.id)
        })
      )
      expect(result).toStrictEqual(Option.some(failed))
    })
  })
}
