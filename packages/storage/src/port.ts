import { Context, Data, type Effect, type Option } from "effect"
import type { Chunk, Exchange, ListExchangesOptions } from "./model.js"

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

export interface StorageService {
  /** Upsert by `id`: the proxy writes a record on request start and again on completion. */
  readonly writeExchange: (exchange: Exchange) => Effect.Effect<void, StorageError>
  readonly appendChunk: (chunk: Chunk) => Effect.Effect<void, StorageError>
  readonly getExchange: (id: string) => Effect.Effect<Option.Option<Exchange>, StorageError>
  readonly listExchanges: (
    options?: ListExchangesOptions
  ) => Effect.Effect<ReadonlyArray<Exchange>, StorageError>
  readonly getChunks: (exchangeId: string) => Effect.Effect<ReadonlyArray<Chunk>, StorageError>
}

export class Storage extends Context.Tag("@llmviz/storage/Storage")<Storage, StorageService>() {}
