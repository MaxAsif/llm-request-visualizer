import { Jsonl, Sqlite, Storage } from "@llmviz/storage"
import { Effect } from "effect"
import { loadConfig } from "./config.js"
import { start } from "./server.js"

const config = loadConfig()

const storagePath = config.storageBackend === "jsonl" ? config.jsonlDirectory : config.databasePath

const storageLayer =
  config.storageBackend === "jsonl" ? Jsonl.layer(storagePath) : Sqlite.layer(storagePath)

const main = Effect.gen(function* () {
  const storage = yield* Storage
  const handle = yield* Effect.promise(() => start(config, storage))
  yield* Effect.addFinalizer(() => Effect.promise(() => handle.close()))
  yield* Effect.logInfo(
    `proxy listening on http://${config.host}:${handle.port} ` +
      `(storage: ${config.storageBackend} at ${storagePath}, ` +
      `redaction: ${config.redactHeaders ? "on" : "off"})`
  )
  yield* Effect.never
})

Effect.runPromise(Effect.scoped(Effect.provide(main, storageLayer))).catch((cause: unknown) => {
  console.error(cause)
  process.exit(1)
})
