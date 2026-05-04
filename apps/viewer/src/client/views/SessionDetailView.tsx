import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { CanonicalView } from "../components/CanonicalBlocks.js"
import { DiffView } from "../components/DiffView.js"
import { ErrorState, LoadingState } from "../components/QueryState.js"
import { RawView } from "../components/RawView.js"
import { StatusChip } from "../components/StatusChip.js"
import { formatDuration, formatTime } from "../lib/format.js"
import type { SessionExchange, Source } from "../lib/types.js"
import { useTRPC } from "../trpc.js"

type ExchangeMode = "diff" | "canonical" | "raw"

const SessionExchangeCard = ({
  exchange,
  index,
  collapsed,
  onToggle
}: {
  exchange: SessionExchange
  index: number
  collapsed: boolean
  onToggle: () => void
}) => {
  const modes: ReadonlyArray<ExchangeMode> = exchange.diff === null ? ["canonical", "raw"] : ["diff", "canonical", "raw"]
  const [mode, setMode] = useState<ExchangeMode>(modes[0]!)
  const diverged = exchange.diff?.diverged === true

  return (
    <li className={`rail__item${diverged ? " is-diverged" : ""}`}>
      <span className="rail__node">{index + 1}</span>
      <div className="card">
        <button type="button" className="card__header" onClick={onToggle}>
          <span className="card__summary">
            {formatTime(exchange.summary.timestampStart)}
            <span className="meta__sep">·</span>
            <code>{exchange.summary.path}</code>
            <span className="meta__sep">·</span>
            <StatusChip exchange={exchange.summary} />
            <span className="meta__sep">·</span>
            {formatDuration(exchange.summary)}
            {diverged ? (
              <>
                <span className="meta__sep">·</span>
                <span style={{ color: "var(--accent-coral)" }}>diverged</span>
              </>
            ) : null}
          </span>
          <span className={`card__chevron${collapsed ? "" : " is-open"}`}>▸</span>
        </button>
        {collapsed ? null : (
          <div className="card__body">
            <nav className="subtabs">
              {modes.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`subtab${mode === name ? " is-active" : ""}`}
                  onClick={() => setMode(name)}
                >
                  {name}
                </button>
              ))}
            </nav>
            {mode === "diff" && exchange.diff !== null ? (
              <DiffView canonical={exchange.canonical} diff={exchange.diff} />
            ) : null}
            {mode === "canonical" ? <CanonicalView canonical={exchange.canonical} /> : null}
            {mode === "raw" ? <RawView raw={exchange.raw} /> : null}
          </div>
        )}
      </div>
    </li>
  )
}

export interface SessionQuery {
  readonly id: string
  readonly limit: number
  readonly idleTimeoutMinutes: number
  readonly source?: Source
}

export const SessionDetailView = ({ query, onBack }: { query: SessionQuery; onBack: () => void }) => {
  const trpc = useTRPC()
  const session = useQuery(trpc.sessions.get.queryOptions(query))
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set())

  const toggle = (id: string) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allIds = (session.data?.exchanges ?? []).map((exchange) => exchange.summary.id)
  const allCollapsed = allIds.length > 0 && allIds.every((id) => collapsedIds.has(id))

  return (
    <>
      <button type="button" className="crumb" onClick={onBack}>
        ← back
      </button>
      {session.isPending ? <LoadingState label="Loading session" /> : null}
      {session.error !== null ? <ErrorState message={session.error.message} /> : null}
      {session.data === undefined ? null : (
        <>
          <div className="meta">
            {formatTime(session.data.timestampStart)} – {formatTime(session.data.timestampEnd)}
            <span className="meta__sep">·</span>
            {session.data.exchanges.length} exchange{session.data.exchanges.length === 1 ? "" : "s"}
            <span className="meta__sep">·</span>
            {session.data.source} / {session.data.providerFormat}
            {session.data.models.length > 0 ? (
              <>
                <span className="meta__sep">·</span>
                {session.data.models.join(", ")}
              </>
            ) : null}
            <span className="meta__sep">·</span>
            <span style={{ color: "var(--text-faint)" }}>grouped by {session.data.groupedBy}</span>
            <span className="meta__sep">·</span>
            <button
              type="button"
              className="btn"
              onClick={() => setCollapsedIds(allCollapsed ? new Set() : new Set(allIds))}
            >
              {allCollapsed ? "Expand all" : "Minimize all"}
            </button>
          </div>
          <ol className="rail">
            {session.data.exchanges.map((exchange, index) => (
              <SessionExchangeCard
                key={exchange.summary.id}
                exchange={exchange}
                index={index}
                collapsed={collapsedIds.has(exchange.summary.id)}
                onToggle={() => toggle(exchange.summary.id)}
              />
            ))}
          </ol>
        </>
      )}
    </>
  )
}
