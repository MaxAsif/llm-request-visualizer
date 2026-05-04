import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Layer, Option } from "effect"
import type { Chunk, Exchange, Headers, ListExchangesOptions } from "./model.js"
import { Storage, StorageError, type StorageService } from "./port.js"

interface ExchangeRecord {
  id: string
  timestamp_start: number
  timestamp_end: number | null
  source: string
  provider_format: string
  http_method: string
  path: string
  upstream_host: string
  status_code: number | null
  request_headers: Headers
  request_body: string
  is_streaming: boolean
  response_headers: Headers | null
  response_body: string | null
  response_complete: boolean
  proxy_error: string | null
}

interface ChunkRecord {
  id: string
  exchange_id: string
  sequence: number
  timestamp: number
  raw_data: string
}

const toBase64 = (data: Uint8Array): string => Buffer.from(data).toString("base64")
const fromBase64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "base64"))

const encodeExchange = (exchange: Exchange): ExchangeRecord => ({
  ...exchange,
  request_body: toBase64(exchange.request_body),
  response_body: exchange.response_body === null ? null : toBase64(exchange.response_body)
})

const decodeExchange = (record: ExchangeRecord): Exchange => ({
  ...record,
  source: record.source as Exchange["source"],
  provider_format: record.provider_format as Exchange["provider_format"],
  request_body: fromBase64(record.request_body),
  response_body: record.response_body === null ? null : fromBase64(record.response_body)
})

const encodeChunk = (chunk: Chunk): ChunkRecord => ({
  ...chunk,
  raw_data: toBase64(chunk.raw_data)
})

const decodeChunk = (record: ChunkRecord): Chunk => ({
  ...record,
  raw_data: fromBase64(record.raw_data)
})

const readLines = <A>(file: string): A[] => {
  let contents: string
  try {
    contents = readFileSync(file, "utf8")
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return []
    throw cause
  }
  return contents
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as A)
}

const appendLine = (file: string, record: unknown): void => {
  appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8")
}

const make = (directory: string): StorageService => {
  mkdirSync(directory, { recursive: true })
  const exchangesFile = join(directory, "exchanges.jsonl")
  const chunksFile = join(directory, "chunks.jsonl")

  // Both files are append-only; upserts are last-write-wins replays of the log into
  // these indexes, so an in-flight exchange never forces a rewrite of the file.
  const exchanges = new Map<string, Exchange>()
  const chunks = new Map<string, Chunk[]>()

  for (const record of readLines<ExchangeRecord>(exchangesFile)) {
    exchanges.set(record.id, decodeExchange(record))
  }
  for (const record of readLines<ChunkRecord>(chunksFile)) {
    const chunk = decodeChunk(record)
    const existing = chunks.get(chunk.exchange_id)
    if (existing === undefined) chunks.set(chunk.exchange_id, [chunk])
    else existing.push(chunk)
  }

  const attempt = <A>(operation: string, run: () => A): Effect.Effect<A, StorageError> =>
    Effect.try({
      try: run,
      catch: (cause) => new StorageError({ operation, cause })
    })

  return {
    writeExchange: (exchange) =>
      attempt("writeExchange", () => {
        appendLine(exchangesFile, encodeExchange(exchange))
        exchanges.set(exchange.id, exchange)
      }),

    appendChunk: (chunk) =>
      attempt("appendChunk", () => {
        appendLine(chunksFile, encodeChunk(chunk))
        const existing = chunks.get(chunk.exchange_id)
        if (existing === undefined) chunks.set(chunk.exchange_id, [chunk])
        else existing.push(chunk)
      }),

    getExchange: (id) =>
      attempt("getExchange", () => Option.fromNullable(exchanges.get(id))),

    listExchanges: (options?: ListExchangesOptions) =>
      attempt("listExchanges", () => {
        const matching = [...exchanges.values()].filter(
          (exchange) =>
            (options?.source === undefined || exchange.source === options.source) &&
            (options?.provider_format === undefined ||
              exchange.provider_format === options.provider_format)
        )
        matching.sort((a, b) =>
          a.timestamp_start === b.timestamp_start
            ? a.id.localeCompare(b.id)
            : a.timestamp_start - b.timestamp_start
        )
        const offset = options?.offset ?? 0
        const end = options?.limit === undefined ? matching.length : offset + options.limit
        return matching.slice(offset, end)
      }),

    getChunks: (exchangeId) =>
      attempt("getChunks", () =>
        [...(chunks.get(exchangeId) ?? [])].sort((a, b) => a.sequence - b.sequence)
      )
  }
}

export const layer = (directory: string): Layer.Layer<Storage, StorageError> =>
  Layer.effect(
    Storage,
    Effect.try({
      try: () => make(directory),
      catch: (cause) => new StorageError({ operation: "open", cause })
    })
  )
