import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Option } from "effect"
import { afterAll, expect, it } from "vitest"
import { layer } from "../src/jsonl.js"
import { Storage } from "../src/port.js"
import { nonStreamingExchange, streamingChunks, streamingExchange, testStorageContract } from "./contract.js"

const tempDir = mkdtempSync(join(tmpdir(), "llmviz-jsonl-"))
afterAll(() => rmSync(tempDir, { recursive: true, force: true }))

let directories = 0
const freshDirectory = () => join(tempDir, `case-${directories++}`)

testStorageContract("jsonl", () => layer(freshDirectory()))

it("replays the logs on reopen and appends chunks without rewriting", async () => {
  const directory = freshDirectory()

  await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const storage = yield* Storage
          yield* storage.writeExchange(nonStreamingExchange)
          yield* storage.writeExchange(streamingExchange)
          yield* Effect.forEach(streamingChunks, (chunk) => storage.appendChunk(chunk))
        }),
        layer(directory)
      )
    )
  )

  const chunkLines = readFileSync(join(directory, "chunks.jsonl"), "utf8").trimEnd().split("\n")
  expect(chunkLines).toHaveLength(streamingChunks.length)

  const reread = await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const storage = yield* Storage
          const exchange = yield* storage.getExchange(nonStreamingExchange.id)
          const chunks = yield* storage.getChunks(streamingExchange.id)
          return { exchange, chunks }
        }),
        layer(directory)
      )
    )
  )

  expect(reread.exchange).toStrictEqual(Option.some(nonStreamingExchange))
  expect(reread.chunks).toStrictEqual(streamingChunks)
})
