import { useQuery } from "@tanstack/react-query"
import type { ExchangeSummary } from "../server/router.js"
import { useTRPC } from "./trpc.js"

const formatTime = (ms: number): string => new Date(ms).toLocaleTimeString()

const formatDuration = (exchange: ExchangeSummary): string =>
  exchange.timestampEnd === null ? "—" : `${exchange.timestampEnd - exchange.timestampStart}ms`

const statusLabel = (exchange: ExchangeSummary): string => {
  if (exchange.proxyError !== null) return `proxy error: ${exchange.proxyError}`
  if (exchange.statusCode === null) return "pending"
  return exchange.responseComplete ? String(exchange.statusCode) : `${exchange.statusCode} (partial)`
}

export const App = () => {
  const trpc = useTRPC()
  const exchanges = useQuery({
    ...trpc.exchanges.list.queryOptions({ limit: 200 }),
    refetchInterval: 2000
  })

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "1.5rem" }}>
      <h1 style={{ fontSize: "1.25rem" }}>Exchanges</h1>
      {exchanges.isPending ? <p>Loading…</p> : null}
      {exchanges.error !== null ? <p style={{ color: "crimson" }}>{exchanges.error.message}</p> : null}
      {exchanges.data !== undefined && exchanges.data.length === 0 ? (
        <p>No exchanges recorded yet. Send a request through the proxy.</p>
      ) : null}
      {exchanges.data !== undefined && exchanges.data.length > 0 ? (
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th>Time</th>
              <th>Source</th>
              <th>Provider</th>
              <th>Method</th>
              <th>Path</th>
              <th>Status</th>
              <th>Stream</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {exchanges.data.map((exchange) => (
              <tr key={exchange.id} style={{ borderBottom: "1px solid #eee" }}>
                <td>{formatTime(exchange.timestampStart)}</td>
                <td>{exchange.source}</td>
                <td>{exchange.providerFormat}</td>
                <td>{exchange.httpMethod}</td>
                <td>
                  <code>{exchange.path}</code>
                </td>
                <td>{statusLabel(exchange)}</td>
                <td>{exchange.isStreaming ? "yes" : "no"}</td>
                <td>{formatDuration(exchange)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  )
}
