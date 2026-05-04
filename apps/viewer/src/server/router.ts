import { Anthropic, OpenAI } from "@llmviz/canonical"
import type { Chunk, Exchange, ListExchangesOptions, StorageService } from "@llmviz/storage"
import { TRPCError, initTRPC } from "@trpc/server"
import { Effect } from "effect"
import { z } from "zod"
import { DEFAULT_IDLE_TIMEOUT_MINUTES, groupSessions, type SessionCandidate } from "./sessions.js"

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

export interface SessionSummary {
  readonly id: string
  readonly timestampStart: number
  readonly timestampEnd: number
  readonly source: Exchange["source"]
  readonly providerFormat: Exchange["provider_format"]
  readonly models: ReadonlyArray<string>
  readonly groupedBy: "native" | "prefix"
  readonly exchanges: ReadonlyArray<ExchangeSummary>
}

const toCanonical = (exchange: Exchange, chunks: ReadonlyArray<Chunk>) =>
  exchange.provider_format === "anthropic"
    ? Anthropic.normalize(exchange, chunks)
    : OpenAI.normalize(exchange, chunks)

const listInput = z.object({
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
  source: z.enum(["claude-code", "codex", "unknown"]).optional(),
  providerFormat: z.enum(["anthropic", "openai"]).optional()
})

const sessionsInput = listInput.extend({
  idleTimeoutMinutes: z.number().positive().max(1440).default(DEFAULT_IDLE_TIMEOUT_MINUTES),
  model: z.string().optional(),
  sort: z.enum(["newest", "oldest"]).default("newest")
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

  const listOptions = (input?: z.infer<typeof listInput>): ListExchangesOptions => ({
    ...(input?.limit === undefined ? {} : { limit: input.limit }),
    ...(input?.offset === undefined ? {} : { offset: input.offset }),
    ...(input?.source === undefined ? {} : { source: input.source }),
    ...(input?.providerFormat === undefined ? {} : { provider_format: input.providerFormat })
  })

  return t.router({
    exchanges: t.router({
      list: t.procedure.input(listInput.optional()).query(async ({ input }) => {
        const exchanges = await run(storage.listExchanges(listOptions(input)))
        return exchanges.map(summarize)
      })
    }),
    sessions: t.router({
      list: t.procedure.input(sessionsInput).query(async ({ input }): Promise<ReadonlyArray<SessionSummary>> => {
        const exchanges = await run(storage.listExchanges(listOptions(input)))

        const candidates: SessionCandidate[] = []
        for (const exchange of exchanges) {
          const chunks = exchange.is_streaming ? await run(storage.getChunks(exchange.id)) : []
          candidates.push({ exchange, canonical: toCanonical(exchange, chunks) })
        }

        const sessions = groupSessions(candidates, input.idleTimeoutMinutes)
          .filter((session) => input.model === undefined || session.models.includes(input.model))
          .map((session) => ({
            id: session.id,
            timestampStart: session.timestampStart,
            timestampEnd: session.timestampEnd,
            source: session.source,
            providerFormat: session.providerFormat,
            models: session.models,
            groupedBy: session.groupedBy,
            exchanges: session.exchanges.map(summarize)
          }))

        return sessions.sort((a, b) =>
          input.sort === "newest"
            ? b.timestampStart - a.timestampStart
            : a.timestampStart - b.timestampStart
        )
      })
    })
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>
