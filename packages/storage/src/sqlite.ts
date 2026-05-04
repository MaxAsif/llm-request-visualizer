import Database from "better-sqlite3"
import { Effect, Layer, Option } from "effect"
import type { Chunk, Exchange, Headers, ListExchangesOptions } from "./model.js"
import { Storage, StorageError, type StorageService } from "./port.js"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS exchanges (
  id TEXT PRIMARY KEY,
  timestamp_start INTEGER NOT NULL,
  timestamp_end INTEGER,
  source TEXT NOT NULL,
  provider_format TEXT NOT NULL,
  http_method TEXT NOT NULL,
  path TEXT NOT NULL,
  upstream_host TEXT NOT NULL,
  status_code INTEGER,
  request_headers TEXT NOT NULL,
  request_body BLOB NOT NULL,
  is_streaming INTEGER NOT NULL,
  response_headers TEXT,
  response_body BLOB,
  response_complete INTEGER NOT NULL,
  proxy_error TEXT
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  exchange_id TEXT NOT NULL REFERENCES exchanges(id),
  sequence INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  raw_data BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_exchange_sequence ON chunks(exchange_id, sequence);
CREATE INDEX IF NOT EXISTS idx_exchanges_timestamp_start ON exchanges(timestamp_start);
`

interface ExchangeRow {
  id: string
  timestamp_start: number
  timestamp_end: number | null
  source: string
  provider_format: string
  http_method: string
  path: string
  upstream_host: string
  status_code: number | null
  request_headers: string
  request_body: Buffer
  is_streaming: number
  response_headers: string | null
  response_body: Buffer | null
  response_complete: number
  proxy_error: string | null
}

interface ChunkRow {
  id: string
  exchange_id: string
  sequence: number
  timestamp: number
  raw_data: Buffer
}

const bytes = (buffer: Buffer): Uint8Array => new Uint8Array(buffer)

const decodeExchange = (row: ExchangeRow): Exchange => ({
  id: row.id,
  timestamp_start: row.timestamp_start,
  timestamp_end: row.timestamp_end,
  source: row.source as Exchange["source"],
  provider_format: row.provider_format as Exchange["provider_format"],
  http_method: row.http_method,
  path: row.path,
  upstream_host: row.upstream_host,
  status_code: row.status_code,
  request_headers: JSON.parse(row.request_headers) as Headers,
  request_body: bytes(row.request_body),
  is_streaming: row.is_streaming !== 0,
  response_headers: row.response_headers === null ? null : (JSON.parse(row.response_headers) as Headers),
  response_body: row.response_body === null ? null : bytes(row.response_body),
  response_complete: row.response_complete !== 0,
  proxy_error: row.proxy_error
})

const decodeChunk = (row: ChunkRow): Chunk => ({
  id: row.id,
  exchange_id: row.exchange_id,
  sequence: row.sequence,
  timestamp: row.timestamp,
  raw_data: bytes(row.raw_data)
})

const make = (db: Database.Database): StorageService => {
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  db.exec(SCHEMA)

  const insertExchange = db.prepare<unknown[]>(`
    INSERT INTO exchanges (
      id, timestamp_start, timestamp_end, source, provider_format, http_method, path,
      upstream_host, status_code, request_headers, request_body, is_streaming,
      response_headers, response_body, response_complete, proxy_error
    ) VALUES (
      @id, @timestamp_start, @timestamp_end, @source, @provider_format, @http_method, @path,
      @upstream_host, @status_code, @request_headers, @request_body, @is_streaming,
      @response_headers, @response_body, @response_complete, @proxy_error
    )
    ON CONFLICT(id) DO UPDATE SET
      timestamp_start = excluded.timestamp_start,
      timestamp_end = excluded.timestamp_end,
      source = excluded.source,
      provider_format = excluded.provider_format,
      http_method = excluded.http_method,
      path = excluded.path,
      upstream_host = excluded.upstream_host,
      status_code = excluded.status_code,
      request_headers = excluded.request_headers,
      request_body = excluded.request_body,
      is_streaming = excluded.is_streaming,
      response_headers = excluded.response_headers,
      response_body = excluded.response_body,
      response_complete = excluded.response_complete,
      proxy_error = excluded.proxy_error
  `)

  const insertChunk = db.prepare<unknown[]>(`
    INSERT INTO chunks (id, exchange_id, sequence, timestamp, raw_data)
    VALUES (@id, @exchange_id, @sequence, @timestamp, @raw_data)
  `)

  const selectExchange = db.prepare<[string]>(`SELECT * FROM exchanges WHERE id = ?`)
  const selectChunks = db.prepare<[string]>(
    `SELECT * FROM chunks WHERE exchange_id = ? ORDER BY sequence ASC`
  )

  const attempt = <A>(operation: string, run: () => A): Effect.Effect<A, StorageError> =>
    Effect.try({
      try: run,
      catch: (cause) => new StorageError({ operation, cause })
    })

  return {
    writeExchange: (exchange) =>
      attempt("writeExchange", () => {
        insertExchange.run({
          ...exchange,
          status_code: exchange.status_code,
          request_headers: JSON.stringify(exchange.request_headers),
          request_body: Buffer.from(exchange.request_body),
          is_streaming: exchange.is_streaming ? 1 : 0,
          response_headers:
            exchange.response_headers === null ? null : JSON.stringify(exchange.response_headers),
          response_body: exchange.response_body === null ? null : Buffer.from(exchange.response_body),
          response_complete: exchange.response_complete ? 1 : 0
        })
      }),

    appendChunk: (chunk) =>
      attempt("appendChunk", () => {
        insertChunk.run({ ...chunk, raw_data: Buffer.from(chunk.raw_data) })
      }),

    getExchange: (id) =>
      attempt("getExchange", () => {
        const row = selectExchange.get(id) as ExchangeRow | undefined
        return row === undefined ? Option.none() : Option.some(decodeExchange(row))
      }),

    listExchanges: (options?: ListExchangesOptions) =>
      attempt("listExchanges", () => {
        const filters: string[] = []
        const params: Record<string, unknown> = {}
        if (options?.source !== undefined) {
          filters.push("source = @source")
          params["source"] = options.source
        }
        if (options?.provider_format !== undefined) {
          filters.push("provider_format = @provider_format")
          params["provider_format"] = options.provider_format
        }
        const where = filters.length === 0 ? "" : ` WHERE ${filters.join(" AND ")}`
        const limit = options?.limit ?? -1
        const offset = options?.offset ?? 0
        const rows = db
          .prepare(
            `SELECT * FROM exchanges${where} ORDER BY timestamp_start ASC, id ASC LIMIT @limit OFFSET @offset`
          )
          .all({ ...params, limit, offset }) as ExchangeRow[]
        return rows.map(decodeExchange)
      }),

    getChunks: (exchangeId) =>
      attempt("getChunks", () => (selectChunks.all(exchangeId) as ChunkRow[]).map(decodeChunk))
  }
}

export const layer = (filename: string): Layer.Layer<Storage, StorageError> =>
  Layer.scoped(
    Storage,
    Effect.acquireRelease(
      Effect.try({
        try: () => new Database(filename),
        catch: (cause) => new StorageError({ operation: "open", cause })
      }),
      (db) => Effect.sync(() => db.close())
    ).pipe(
      Effect.flatMap((db) =>
        Effect.try({
          try: () => make(db),
          catch: (cause) => new StorageError({ operation: "migrate", cause })
        })
      )
    )
  )
