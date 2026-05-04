import type { ExchangeSummary } from "../../server/router.js"

export const formatTime = (ms: number): string => new Date(ms).toLocaleTimeString()

export const formatDuration = (exchange: ExchangeSummary): string =>
  exchange.timestampEnd === null ? "—" : `${exchange.timestampEnd - exchange.timestampStart}ms`

export type StatusKind = "ok" | "warn" | "err" | "pending"

export const statusKind = (exchange: ExchangeSummary): StatusKind => {
  if (exchange.proxyError !== null) return "err"
  if (exchange.statusCode === null) return "pending"
  if (exchange.statusCode >= 500) return "err"
  if (exchange.statusCode >= 400) return "warn"
  return "ok"
}

export const statusLabel = (exchange: ExchangeSummary): string => {
  if (exchange.proxyError !== null) return `proxy error: ${exchange.proxyError}`
  if (exchange.statusCode === null) return "pending"
  return exchange.responseComplete ? String(exchange.statusCode) : `${exchange.statusCode} (partial)`
}

export const prettyJson = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** Maps a message role to the semantic role class suffix used throughout the UI. */
export const roleClass = (role: string): string => {
  if (role === "user") return "user"
  if (role === "assistant") return "assistant"
  if (role === "system") return "system"
  return "tool"
}
