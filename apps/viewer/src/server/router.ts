import type { Exchange, ListExchangesOptions, StorageService } from "@llmviz/storage"
import { TRPCError, initTRPC } from "@trpc/server"
import { Effect } from "effect"
import { z } from "zod"

export interface ExchangeSummary {
  readonly id: string
  readonly timestampStart: number
  readonly timestampEnd: number | null
  readonly source: Exchange["source"]
  readonly providerFormat: Exchange["provider_format"]
  readonly httpMethod: string
  readonly path: string
  readonly upstreamHost: string
  readonly statusCode: number | null
  readonly isStreaming: boolean
  readonly responseComplete: boolean
  readonly proxyError: string | null
  readonly requestBytes: number
}

const summarize = (exchange: Exchange): ExchangeSummary => ({
  id: exchange.id,
  timestampStart: exchange.timestamp_start,
  timestampEnd: exchange.timestamp_end,
  source: exchange.source,
  providerFormat: exchange.provider_format,
  httpMethod: exchange.http_method,
  path: exchange.path,
  upstreamHost: exchange.upstream_host,
  statusCode: exchange.status_code,
  isStreaming: exchange.is_streaming,
  responseComplete: exchange.response_complete,
  proxyError: exchange.proxy_error,
  requestBytes: exchange.request_body.byteLength
})

const listInput = z.object({
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
  source: z.enum(["claude-code", "codex", "unknown"]).optional(),
  providerFormat: z.enum(["anthropic", "openai"]).optional()
})

const t = initTRPC.create()

export const createAppRouter = (storage: StorageService) => {
  const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
    Effect.runPromise(
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "storage read failed", cause })
        )
      )
    )

  return t.router({
    exchanges: t.router({
      list: t.procedure.input(listInput.optional()).query(async ({ input }) => {
        const options: ListExchangesOptions = {
          ...(input?.limit === undefined ? {} : { limit: input.limit }),
          ...(input?.offset === undefined ? {} : { offset: input.offset }),
          ...(input?.source === undefined ? {} : { source: input.source }),
          ...(input?.providerFormat === undefined ? {} : { provider_format: input.providerFormat })
        }
        const exchanges = await run(storage.listExchanges(options))
        return exchanges.map(summarize)
      })
    })
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>
