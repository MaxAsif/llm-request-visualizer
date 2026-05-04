import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { ExchangeTable } from "../components/ExchangeTable.js"
import { EmptyState, ErrorState, LoadingState } from "../components/QueryState.js"
import { formatTime } from "../lib/format.js"
import type { SessionSummary, Source } from "../lib/types.js"
import { useTRPC } from "../trpc.js"
import type { SessionQuery } from "./SessionDetailView.js"

const SessionCard = ({
  session,
  onSelect,
  onOpenSession
}: {
  session: SessionSummary
  onSelect: (id: string) => void
  onOpenSession: (id: string) => void
}) => {
  const [expanded, setExpanded] = useState(false)
  return (
    <li className="card">
      <button type="button" className="card__header" onClick={() => setExpanded(!expanded)}>
        <span className="card__summary">
          <strong>{formatTime(session.timestampStart)}</strong>
          {" – "}
          {formatTime(session.timestampEnd)}
          <span className="meta__sep">·</span>
          {session.exchanges.length} exchange{session.exchanges.length === 1 ? "" : "s"}
          <span className="meta__sep">·</span>
          {session.source} / {session.providerFormat}
          {session.models.length > 0 ? (
            <>
              <span className="meta__sep">·</span>
              {session.models.join(", ")}
            </>
          ) : null}
          <span className="meta__sep">·</span>
          <span style={{ color: "var(--text-faint)" }}>grouped by {session.groupedBy}</span>
        </span>
        <span className={`card__chevron${expanded ? " is-open" : ""}`}>▸</span>
      </button>
      <div className="card__actions">
        <button type="button" className="btn" onClick={() => onOpenSession(session.id)}>
          Open session
        </button>
      </div>
      {expanded ? (
        <div className="card__body">
          <ExchangeTable exchanges={session.exchanges} onSelect={onSelect} />
        </div>
      ) : null}
    </li>
  )
}

const SESSION_LIMIT = 500

export const SessionsView = ({
  onSelect,
  onOpenSession
}: {
  onSelect: (id: string) => void
  onOpenSession: (query: SessionQuery) => void
}) => {
  const trpc = useTRPC()
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(30)
  const [source, setSource] = useState<Source | "">("")
  const [model, setModel] = useState("")
  const [sort, setSort] = useState<"newest" | "oldest">("newest")

  const sessions = useQuery({
    ...trpc.sessions.list.queryOptions({
      limit: SESSION_LIMIT,
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
      <div className="filterbar">
        <label className="field">
          <span className="field__label">Idle timeout (min)</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={idleTimeoutMinutes}
            onChange={(event) => setIdleTimeoutMinutes(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
        <label className="field">
          <span className="field__label">Source</span>
          <select value={source} onChange={(event) => setSource(event.target.value as Source | "")}>
            <option value="">all</option>
            <option value="claude-code">claude-code</option>
            <option value="codex">codex</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Model</span>
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
        <label className="field">
          <span className="field__label">Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as "newest" | "oldest")}>
            <option value="newest">newest first</option>
            <option value="oldest">oldest first</option>
          </select>
        </label>
      </div>
      {sessions.isPending ? <LoadingState label="Loading sessions" /> : null}
      {sessions.error !== null ? <ErrorState message={sessions.error.message} /> : null}
      {sessions.data !== undefined && sessions.data.length === 0 ? (
        <EmptyState
          title="No sessions recorded yet"
          hint="Sessions are grouped from exchanges automatically — send a request through the proxy to start one."
        />
      ) : null}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {(sessions.data ?? []).map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onSelect={onSelect}
            onOpenSession={(id) =>
              onOpenSession({
                id,
                limit: SESSION_LIMIT,
                idleTimeoutMinutes,
                ...(source === "" ? {} : { source })
              })
            }
          />
        ))}
      </ul>
    </>
  )
}
