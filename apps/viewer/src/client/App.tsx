import { useQuery } from "@tanstack/react-query"
import type { inferRouterOutputs } from "@trpc/server"
import { useState } from "react"
import type { AppRouter, ExchangeSummary, SessionSummary } from "../server/router.js"
import { useTRPC } from "./trpc.js"

/** Inferred rather than imported: JSON serialization widens `unknown` fields to optional. */
type ExchangeDetail = inferRouterOutputs<AppRouter>["exchanges"]["get"]
type CanonicalExchange = ExchangeDetail["canonical"]
type ContentBlock = CanonicalExchange["messages"][number]["content"][number]
type RawPayload = ExchangeDetail["raw"]

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

const ExchangeTable = ({
  exchanges,
  onSelect
}: {
  exchanges: ReadonlyArray<ExchangeSummary>
  onSelect: (id: string) => void
}) => (
  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.875rem" }}>
    <thead>
      <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
        <th style={cell} />
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
          <td style={cell}>
            <button type="button" onClick={() => onSelect(exchange.id)} style={{ cursor: "pointer" }}>
              open
            </button>
          </td>
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

const pre = {
  background: "#f6f6f6",
  border: "1px solid #eee",
  borderRadius: "0.25rem",
  padding: "0.5rem",
  overflowX: "auto" as const,
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
  fontSize: "0.8125rem",
  margin: "0.25rem 0"
}

const prettyJson = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ marginBottom: "1rem" }}>
    <h3 style={{ fontSize: "0.9375rem", margin: "0 0 0.25rem" }}>{title}</h3>
    {children}
  </section>
)

const Block = ({ block }: { block: ContentBlock }) => {
  if (block.type === "text") return <pre style={pre}>{block.text}</pre>
  if (block.type === "thinking") return <pre style={{ ...pre, fontStyle: "italic" }}>{block.text}</pre>
  if (block.type === "tool_use") {
    return (
      <pre style={pre}>
        {`→ ${block.name} (${block.id})\n${JSON.stringify(block.input, null, 2)}`}
      </pre>
    )
  }
  if (block.type === "tool_result") {
    return (
      <pre style={{ ...pre, borderColor: block.isError ? "crimson" : "#eee" }}>
        {`← ${block.toolUseId}${block.isError ? " (error)" : ""}\n${block.content}`}
      </pre>
    )
  }
  return <pre style={pre}>{JSON.stringify(block.raw, null, 2)}</pre>
}

const CanonicalView = ({ canonical }: { canonical: CanonicalExchange }) => (
  <>
    <Section title="Overview">
      <div style={{ fontSize: "0.875rem" }}>
        model: <code>{canonical.model ?? "—"}</code> · stop reason:{" "}
        <code>{canonical.stopReason ?? "—"}</code>
      </div>
    </Section>
    {canonical.systemPrompt === null ? null : (
      <Section title="System prompt">
        <pre style={pre}>{canonical.systemPrompt}</pre>
      </Section>
    )}
    <Section title={`Messages (${canonical.messages.length})`}>
      {canonical.messages.map((message, index) => (
        <div key={index} style={{ marginBottom: "0.5rem" }}>
          <strong style={{ fontSize: "0.8125rem" }}>{message.role}</strong>
          {message.content.map((block, blockIndex) => (
            <Block key={blockIndex} block={block} />
          ))}
        </div>
      ))}
    </Section>
    {canonical.reasoning.length === 0 ? null : (
      <Section title="Reasoning">
        {canonical.reasoning.map((entry, index) => (
          <pre key={index} style={{ ...pre, fontStyle: "italic" }}>
            {entry.text}
          </pre>
        ))}
      </Section>
    )}
    <Section title="Response">
      <pre style={pre}>{canonical.responseText === "" ? "—" : canonical.responseText}</pre>
    </Section>
    {canonical.toolCalls.length === 0 ? null : (
      <Section title={`Tool calls (${canonical.toolCalls.length})`}>
        {canonical.toolCalls.map((call) => (
          <pre key={call.id} style={pre}>
            {`${call.name} (${call.id})\n${JSON.stringify(call.input, null, 2)}`}
          </pre>
        ))}
      </Section>
    )}
    {canonical.toolResults.length === 0 ? null : (
      <Section title={`Tool results (${canonical.toolResults.length})`}>
        {canonical.toolResults.map((result) => (
          <pre key={result.toolUseId} style={pre}>
            {`${result.toolUseId}${result.isError ? " (error)" : ""}\n${result.content}`}
          </pre>
        ))}
      </Section>
    )}
    {canonical.toolDefinitions.length === 0 ? null : (
      <Section title={`Tool definitions (${canonical.toolDefinitions.length})`}>
        <pre style={pre}>{canonical.toolDefinitions.map((tool) => tool.name).join(", ")}</pre>
      </Section>
    )}
    <Section title="Usage">
      <pre style={pre}>
        {Object.keys(canonical.usage).length === 0 ? "—" : JSON.stringify(canonical.usage, null, 2)}
      </pre>
    </Section>
  </>
)

const HeaderTable = ({ headers }: { headers: Readonly<Record<string, string>> }) => (
  <pre style={pre}>
    {Object.entries(headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n") || "—"}
  </pre>
)

const RawView = ({ raw }: { raw: RawPayload }) => (
  <>
    <Section title="Request headers">
      <HeaderTable headers={raw.requestHeaders} />
    </Section>
    <Section title="Request body">
      <pre style={pre}>{prettyJson(raw.requestBody)}</pre>
    </Section>
    <Section title="Response headers">
      {raw.responseHeaders === null ? <pre style={pre}>—</pre> : <HeaderTable headers={raw.responseHeaders} />}
    </Section>
    <Section title="Response body">
      <pre style={pre}>{raw.responseBody === null ? "—" : prettyJson(raw.responseBody)}</pre>
    </Section>
  </>
)

const ChunksView = ({ id }: { id: string }) => {
  const trpc = useTRPC()
  const chunks = useQuery(trpc.exchanges.chunks.queryOptions({ id }))

  if (chunks.isPending) return <p>Loading…</p>
  if (chunks.error !== null) return <p style={{ color: "crimson" }}>{chunks.error.message}</p>
  if ((chunks.data ?? []).length === 0) return <p>No chunks recorded for this exchange.</p>

  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {(chunks.data ?? []).map((chunk) => (
        <li key={chunk.id} style={{ marginBottom: "0.5rem" }}>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>
            #{chunk.sequence} · {formatTime(chunk.timestamp)}
          </div>
          <pre style={pre}>{chunk.data}</pre>
        </li>
      ))}
    </ol>
  )
}

type DetailTab = "canonical" | "raw" | "chunks"

const ExchangeDetailView = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const trpc = useTRPC()
  const [tab, setTab] = useState<DetailTab>("canonical")
  const detail = useQuery(trpc.exchanges.get.queryOptions({ id }))

  const tabs: ReadonlyArray<DetailTab> =
    detail.data?.summary.isStreaming === true
      ? ["canonical", "raw", "chunks"]
      : ["canonical", "raw"]

  return (
    <>
      <button type="button" onClick={onBack} style={{ cursor: "pointer", marginBottom: "0.75rem" }}>
        ← back
      </button>
      {detail.isPending ? <p>Loading…</p> : null}
      {detail.error !== null ? <p style={{ color: "crimson" }}>{detail.error.message}</p> : null}
      {detail.data === undefined ? null : (
        <>
          <div style={{ fontSize: "0.875rem", marginBottom: "0.75rem" }}>
            <code>{detail.data.summary.httpMethod}</code> <code>{detail.data.summary.path}</code> ·{" "}
            {detail.data.summary.source} / {detail.data.summary.providerFormat} ·{" "}
            {statusLabel(detail.data.summary)} · {formatTime(detail.data.summary.timestampStart)} ·{" "}
            {formatDuration(detail.data.summary)}
          </div>
          <nav style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            {tabs.map((name) => (
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
          {tab === "canonical" ? <CanonicalView canonical={detail.data.canonical} /> : null}
          {tab === "raw" ? <RawView raw={detail.data.raw} /> : null}
          {tab === "chunks" ? <ChunksView id={id} /> : null}
        </>
      )}
    </>
  )
}

const SessionCard = ({ session, onSelect }: { session: SessionSummary; onSelect: (id: string) => void }) => {
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
          <ExchangeTable exchanges={session.exchanges} onSelect={onSelect} />
        </div>
      ) : null}
    </li>
  )
}

type Source = "claude-code" | "codex" | "unknown"

const SessionsView = ({ onSelect }: { onSelect: (id: string) => void }) => {
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
          <SessionCard key={session.id} session={session} onSelect={onSelect} />
        ))}
      </ul>
    </>
  )
}

const ExchangesView = ({ onSelect }: { onSelect: (id: string) => void }) => {
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
        <ExchangeTable exchanges={exchanges.data} onSelect={onSelect} />
      ) : null}
    </>
  )
}

export const App = () => {
  const [tab, setTab] = useState<"sessions" | "exchanges">("sessions")
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "1.5rem" }}>
      <h1 style={{ fontSize: "1.25rem" }}>LLM Visualizer</h1>
      {selected === null ? (
        <>
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
          {tab === "sessions" ? (
            <SessionsView onSelect={setSelected} />
          ) : (
            <ExchangesView onSelect={setSelected} />
          )}
        </>
      ) : (
        <ExchangeDetailView id={selected} onBack={() => setSelected(null)} />
      )}
    </main>
  )
}
