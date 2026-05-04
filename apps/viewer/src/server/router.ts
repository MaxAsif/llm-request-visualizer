import { Anthropic, type CanonicalExchange, OpenAI } from "@llmviz/canonical"
import type { Chunk, Exchange, ListExchangesOptions, StorageService } from "@llmviz/storage"
import { TRPCError, initTRPC } from "@trpc/server"
import { Effect, Option } from "effect"
import { z } from "zod"
import { diffExchange, type ExchangeDiff } from "./diff.js"
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

export interface RawPayload {
  readonly requestHeaders: Readonly<Record<string, string>>
  readonly requestBody: string
  readonly responseHeaders: Readonly<Record<string, string>> | null
  readonly responseBody: string | null
}

export interface ExchangeDetail {
  readonly summary: ExchangeSummary
  readonly canonical: CanonicalExchange
  readonly raw: RawPayload
}

export interface SessionExchange extends ExchangeDetail {
  /** Null for the first exchange in a session, which has no prior turn to diff against. */
  readonly diff: ExchangeDiff | null
}

export interface SessionDetail extends Omit<SessionSummary, "exchanges"> {
  readonly exchanges: ReadonlyArray<SessionExchange>
}

export interface ChunkView {
  readonly id: string
  readonly sequence: number
  readonly timestamp: number
  readonly data: string
}

const toCanonical = (exchange: Exchange, chunks: ReadonlyArray<Chunk>) =>
  exchange.provider_format === "anthropic"
    ? Anthropic.normalize(exchange, chunks)
    : OpenAI.normalize(exchange, chunks)

/** Stored bodies are always text/JSON in this domain, and tRPC's JSON transformer mangles bytes. */
const decoder = new TextDecoder()
const decode = (bytes: Uint8Array): string => decoder.decode(bytes)

const listInput = z.object({
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
  source: z.enum(["claude-code", "codex", "unknown"]).optional(),
  providerFormat: z.enum(["anthropic", "openai"]).optional()
})

const idInput = z.object({ id: z.string().min(1) })

const sessionsInput = listInput.extend({
  idleTimeoutMinutes: z.number().positive().max(1440).default(DEFAULT_IDLE_TIMEOUT_MINUTES),
  model: z.string().optional(),
  sort: z.enum(["newest", "oldest"]).default("newest")
})

/** Sessions are derived, not stored, so a detail lookup must regroup with the same knobs. */
const sessionInput = listInput.extend({
  id: z.string().min(1),
  idleTimeoutMinutes: z.number().positive().max(1440).default(DEFAULT_IDLE_TIMEOUT_MINUTES)
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

  const chunksFor = (exchange: Exchange) =>
    exchange.is_streaming ? run(storage.getChunks(exchange.id)) : Promise.resolve([])

  const detail = (exchange: Exchange, chunks: ReadonlyArray<Chunk>): ExchangeDetail => ({
    summary: summarize(exchange),
    canonical: toCanonical(exchange, chunks),
    raw: {
      requestHeaders: exchange.request_headers,
      requestBody: decode(exchange.request_body),
      responseHeaders: exchange.response_headers,
      responseBody: exchange.response_body === null ? null : decode(exchange.response_body)
    }
  })

  const candidatesFor = async (input: z.infer<typeof listInput>): Promise<SessionCandidate[]> => {
    const exchanges = await run(storage.listExchanges(listOptions(input)))
    const candidates: SessionCandidate[] = []
    for (const exchange of exchanges) {
      candidates.push({ exchange, canonical: toCanonical(exchange, await chunksFor(exchange)) })
    }
    return candidates
  }

  return t.router({
    exchanges: t.router({
      list: t.procedure.input(listInput.optional()).query(async ({ input }) => {
        const exchanges = await run(storage.listExchanges(listOptions(input)))
        return exchanges.map(summarize)
      }),
      get: t.procedure.input(idInput).query(async ({ input }): Promise<ExchangeDetail> => {
        const found = await run(storage.getExchange(input.id))
        if (Option.isNone(found)) {
          throw new TRPCError({ code: "NOT_FOUND", message: `no exchange with id ${input.id}` })
        }
        const exchange = found.value
        return detail(exchange, await chunksFor(exchange))
      }),
      chunks: t.procedure.input(idInput).query(async ({ input }): Promise<ReadonlyArray<ChunkView>> => {
        const chunks = await run(storage.getChunks(input.id))
        return chunks.map((chunk) => ({
          id: chunk.id,
          sequence: chunk.sequence,
          timestamp: chunk.timestamp,
          data: decode(chunk.raw_data)
        }))
      })
    }),
    sessions: t.router({
      list: t.procedure.input(sessionsInput).query(async ({ input }): Promise<ReadonlyArray<SessionSummary>> => {
        const candidates = await candidatesFor(input)

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
      }),
      get: t.procedure.input(sessionInput).query(async ({ input }): Promise<SessionDetail> => {
        const candidates = await candidatesFor(input)
        const session = groupSessions(candidates, input.idleTimeoutMinutes).find(
          (candidate) => candidate.id === input.id
        )
        if (session === undefined) {
          throw new TRPCError({ code: "NOT_FOUND", message: `no session with id ${input.id}` })
        }

        const exchanges: SessionExchange[] = []
        for (const [index, exchange] of session.exchanges.entries()) {
          const current = detail(exchange, await chunksFor(exchange))
          const prior = exchanges[index - 1]
          exchanges.push({
            ...current,
            diff: prior === undefined ? null : diffExchange(prior.canonical, current.canonical)
          })
        }

        return {
          id: session.id,
          timestampStart: session.timestampStart,
          timestampEnd: session.timestampEnd,
          source: session.source,
          providerFormat: session.providerFormat,
          models: session.models,
          groupedBy: session.groupedBy,
          exchanges
        }
      })
    })
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>
