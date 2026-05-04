import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Option } from "effect"
import { afterAll, expect, it } from "vitest"
import { Storage } from "../src/port.js"
import { layer } from "../src/sqlite.js"
import { nonStreamingExchange, streamingChunks, streamingExchange, testStorageContract } from "./contract.js"

testStorageContract("sqlite (in-memory)", () => layer(":memory:"))

const tempDir = mkdtempSync(join(tmpdir(), "llmviz-sqlite-"))
afterAll(() => rmSync(tempDir, { recursive: true, force: true }))

it("persists across database reopen", async () => {
  const file = join(tempDir, "exchanges.db")

  await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const storage = yield* Storage
          yield* storage.writeExchange(nonStreamingExchange)
          yield* storage.writeExchange(streamingExchange)
          yield* Effect.forEach(streamingChunks, (chunk) => storage.appendChunk(chunk))
        }),
        layer(file)
      )
    )
  )

  const reread = await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const storage = yield* Storage
          const exchange = yield* storage.getExchange(nonStreamingExchange.id)
          const chunks = yield* storage.getChunks(streamingExchange.id)
          return { exchange, chunks }
        }),
        layer(file)
      )
    )
  )

  expect(reread.exchange).toStrictEqual(Option.some(nonStreamingExchange))
  expect(reread.chunks).toStrictEqual(streamingChunks)
})
