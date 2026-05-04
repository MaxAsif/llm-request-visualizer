import type { inferRouterOutputs } from "@trpc/server"
import type { AppRouter } from "../../server/router.js"

/** Inferred rather than imported: JSON serialization widens `unknown` fields to optional. */
export type ExchangeDetail = inferRouterOutputs<AppRouter>["exchanges"]["get"]
export type CanonicalExchange = ExchangeDetail["canonical"]
export type ContentBlock = CanonicalExchange["messages"][number]["content"][number]
export type RawPayload = ExchangeDetail["raw"]
export type SessionExchange = inferRouterOutputs<AppRouter>["sessions"]["get"]["exchanges"][number]
export type ExchangeSummary = inferRouterOutputs<AppRouter>["exchanges"]["list"][number]
export type SessionSummary = inferRouterOutputs<AppRouter>["sessions"]["list"][number]
export type ChunkView = inferRouterOutputs<AppRouter>["exchanges"]["chunks"][number]
export type Source = "claude-code" | "codex" | "unknown"
