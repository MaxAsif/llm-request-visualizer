import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import type { ExchangeSummary, SessionSummary } from "../server/router.js"
import { useTRPC } from "./trpc.js"

const formatTime = (ms: number): string => new Date(ms).toLocaleTimeString()

const formatDuration = (exchange: ExchangeSummary): string =>
  exchange.timestampEnd === null ? "—" : `${exchange.timestampEnd - exchange.timestampStart}ms`

const statusLabel = (exchange: ExchangeSummary): string => {
  if (exchange.proxyError !== null) return `proxy error: ${exchange.proxyError}`
  if (exchange.statusCode === null) return "pending"
  return exchange.responseComplete ? String(exchange.statusCode) : `${exchange.statusCode} (partial)`
}

const cell = { padding: "0.25rem 0.5rem 0.25rem 0" }
const row = { borderBottom: "1px solid #eee" }

const ExchangeTable = ({ exchanges }: { exchanges: ReadonlyArray<ExchangeSummary> }) => (
  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.875rem" }}>
    <thead>
      <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
        <th style={cell}>Time</th>
        <th style={cell}>Source</th>
        <th style={cell}>Provider</th>
        <th style={cell}>Method</th>
        <th style={cell}>Path</th>
        <th style={cell}>Status</th>
        <th style={cell}>Stream</th>
        <th style={cell}>Duration</th>
      </tr>
    </thead>
    <tbody>
      {exchanges.map((exchange) => (
        <tr key={exchange.id} style={row}>
          <td style={cell}>{formatTime(exchange.timestampStart)}</td>
          <td style={cell}>{exchange.source}</td>
          <td style={cell}>{exchange.providerFormat}</td>
          <td style={cell}>{exchange.httpMethod}</td>
          <td style={cell}>
            <code>{exchange.path}</code>
          </td>
          <td style={cell}>{statusLabel(exchange)}</td>
          <td style={cell}>{exchange.isStreaming ? "yes" : "no"}</td>
          <td style={cell}>{formatDuration(exchange)}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

const SessionCard = ({ session }: { session: SessionSummary }) => {
  const [expanded, setExpanded] = useState(false)
  return (
    <li style={{ border: "1px solid #ddd", borderRadius: "0.25rem", marginBottom: "0.75rem", padding: "0.75rem" }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
      >
        <strong>{formatTime(session.timestampStart)}</strong>
        {" – "}
        {formatTime(session.timestampEnd)}
        {" · "}
        {session.exchanges.length} exchange{session.exchanges.length === 1 ? "" : "s"}
        {" · "}
        {session.source} / {session.providerFormat}
        {session.models.length > 0 ? ` · ${session.models.join(", ")}` : ""}
        <span style={{ color: "#888" }}> · grouped by {session.groupedBy}</span>
      </button>
      {expanded ? (
        <div style={{ marginTop: "0.75rem" }}>
          <ExchangeTable exchanges={session.exchanges} />
        </div>
      ) : null}
    </li>
  )
}

type Source = "claude-code" | "codex" | "unknown"

const SessionsView = () => {
  const trpc = useTRPC()
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(30)
  const [source, setSource] = useState<Source | "">("")
  const [model, setModel] = useState("")
  const [sort, setSort] = useState<"newest" | "oldest">("newest")

  const sessions = useQuery({
    ...trpc.sessions.list.queryOptions({
      limit: 500,
      idleTimeoutMinutes,
      sort,
      ...(source === "" ? {} : { source }),
      ...(model === "" ? {} : { model })
    }),
    refetchInterval: 2000
  })

  const models = [...new Set((sessions.data ?? []).flatMap((session) => session.models))].sort()

  return (
    <>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>
          Idle timeout{" "}
          <input
            type="number"
            min={1}
            max={1440}
            value={idleTimeoutMinutes}
            onChange={(event) => setIdleTimeoutMinutes(Math.max(1, Number(event.target.value) || 1))}
            style={{ width: "4rem" }}
          />{" "}
          min
        </label>
        <label>
          Source{" "}
          <select value={source} onChange={(event) => setSource(event.target.value as Source | "")}>
            <option value="">all</option>
            <option value="claude-code">claude-code</option>
            <option value="codex">codex</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
        <label>
          Model{" "}
          <select value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="">all</option>
            {models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {model !== "" && !models.includes(model) ? <option value={model}>{model}</option> : null}
          </select>
        </label>
        <label>
          Sort{" "}
          <select value={sort} onChange={(event) => setSort(event.target.value as "newest" | "oldest")}>
            <option value="newest">newest first</option>
            <option value="oldest">oldest first</option>
          </select>
        </label>
      </div>
      {sessions.isPending ? <p>Loading…</p> : null}
      {sessions.error !== null ? <p style={{ color: "crimson" }}>{sessions.error.message}</p> : null}
      {sessions.data !== undefined && sessions.data.length === 0 ? (
        <p>No sessions recorded yet. Send a request through the proxy.</p>
      ) : null}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {(sessions.data ?? []).map((session) => (
          <SessionCard key={session.id} session={session} />
        ))}
      </ul>
    </>
  )
}

const ExchangesView = () => {
  const trpc = useTRPC()
  const exchanges = useQuery({
    ...trpc.exchanges.list.queryOptions({ limit: 200 }),
    refetchInterval: 2000
  })

  return (
    <>
      {exchanges.isPending ? <p>Loading…</p> : null}
      {exchanges.error !== null ? <p style={{ color: "crimson" }}>{exchanges.error.message}</p> : null}
      {exchanges.data !== undefined && exchanges.data.length === 0 ? (
        <p>No exchanges recorded yet. Send a request through the proxy.</p>
      ) : null}
      {exchanges.data !== undefined && exchanges.data.length > 0 ? (
        <ExchangeTable exchanges={exchanges.data} />
      ) : null}
    </>
  )
}

export const App = () => {
  const [tab, setTab] = useState<"sessions" | "exchanges">("sessions")

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "1.5rem" }}>
      <h1 style={{ fontSize: "1.25rem" }}>LLM Visualizer</h1>
      <nav style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {(["sessions", "exchanges"] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            style={{ fontWeight: tab === name ? 600 : 400, cursor: "pointer" }}
          >
            {name}
          </button>
        ))}
      </nav>
      {tab === "sessions" ? <SessionsView /> : <ExchangesView />}
    </main>
  )
}
