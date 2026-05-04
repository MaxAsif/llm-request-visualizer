import { Sqlite, Storage } from "@llmviz/storage"
import { createHTTPServer } from "@trpc/server/adapters/standalone"
import { Effect } from "effect"
import { loadConfig } from "./config.js"
import { createAppRouter } from "./router.js"

const config = loadConfig()

const main = Effect.gen(function* () {
  const storage = yield* Storage
  const server = createHTTPServer({ router: createAppRouter(storage) })

  yield* Effect.acquireRelease(
    Effect.async<void>((resume) => {
      server.listen(config.port, config.host, () => {
        resume(Effect.void)
      })
    }),
    () =>
      Effect.async<void>((resume) => {
        server.close(() => {
          resume(Effect.void)
        })
      })
  )

  yield* Effect.logInfo(
    `viewer api listening on http://${config.host}:${config.port} (storage: ${config.databasePath})`
  )
  yield* Effect.never
})

Effect.runPromise(Effect.scoped(Effect.provide(main, Sqlite.layer(config.databasePath)))).catch(
  (cause: unknown) => {
    console.error(cause)
    process.exit(1)
  }
)
