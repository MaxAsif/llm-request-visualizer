import { Schema } from "effect"

export const Source = Schema.Literal("claude-code", "codex", "unknown")
export type Source = typeof Source.Type

export const ProviderFormat = Schema.Literal("anthropic", "openai")
export type ProviderFormat = typeof ProviderFormat.Type

const Headers = Schema.Record({ key: Schema.String, value: Schema.String })
export type Headers = typeof Headers.Type

/** Epoch milliseconds. */
const Timestamp = Schema.Number

export const Exchange = Schema.Struct({
  id: Schema.String,
  timestamp_start: Timestamp,
  timestamp_end: Schema.NullOr(Timestamp),
  source: Source,
  provider_format: ProviderFormat,
  http_method: Schema.String,
  path: Schema.String,
  upstream_host: Schema.String,
  status_code: Schema.NullOr(Schema.Number),
  request_headers: Headers,
  request_body: Schema.Uint8ArrayFromSelf,
  is_streaming: Schema.Boolean,
  response_headers: Schema.NullOr(Headers),
  response_body: Schema.NullOr(Schema.Uint8ArrayFromSelf),
  response_complete: Schema.Boolean,
  proxy_error: Schema.NullOr(Schema.String)
})
export type Exchange = typeof Exchange.Type

export const Chunk = Schema.Struct({
  id: Schema.String,
  exchange_id: Schema.String,
  sequence: Schema.Number,
  timestamp: Timestamp,
  raw_data: Schema.Uint8ArrayFromSelf
})
export type Chunk = typeof Chunk.Type

export const ListExchangesOptions = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  source: Schema.optional(Source),
  provider_format: Schema.optional(ProviderFormat)
})
export type ListExchangesOptions = typeof ListExchangesOptions.Type
