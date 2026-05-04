import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { CanonicalView } from "../components/CanonicalBlocks.js"
import { ChunksView } from "../components/ChunksView.js"
import { ErrorState, LoadingState } from "../components/QueryState.js"
import { RawView } from "../components/RawView.js"
import { StatusChip } from "../components/StatusChip.js"
import { formatDuration, formatTime } from "../lib/format.js"
import { useTRPC } from "../trpc.js"

type DetailTab = "canonical" | "raw" | "chunks"

export const ExchangeDetailView = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const trpc = useTRPC()
  const [tab, setTab] = useState<DetailTab>("canonical")
  const detail = useQuery(trpc.exchanges.get.queryOptions({ id }))

  const tabs: ReadonlyArray<DetailTab> =
    detail.data?.summary.isStreaming === true ? ["canonical", "raw", "chunks"] : ["canonical", "raw"]

  return (
    <>
      <button type="button" className="crumb" onClick={onBack}>
        ← back
      </button>
      {detail.isPending ? <LoadingState label="Loading exchange" /> : null}
      {detail.error !== null ? <ErrorState message={detail.error.message} /> : null}
      {detail.data === undefined ? null : (
        <>
          <div className="meta">
            <code>{detail.data.summary.httpMethod}</code>
            <code>{detail.data.summary.path}</code>
            <span className="meta__sep">·</span>
            {detail.data.summary.source} / {detail.data.summary.providerFormat}
            <span className="meta__sep">·</span>
            <StatusChip exchange={detail.data.summary} />
            <span className="meta__sep">·</span>
            {formatTime(detail.data.summary.timestampStart)}
            <span className="meta__sep">·</span>
            {formatDuration(detail.data.summary)}
          </div>
          <nav className="subtabs">
            {tabs.map((name) => (
              <button
                key={name}
                type="button"
                className={`subtab${tab === name ? " is-active" : ""}`}
                onClick={() => setTab(name)}
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
