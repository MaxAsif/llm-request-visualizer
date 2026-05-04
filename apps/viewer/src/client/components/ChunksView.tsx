import { useQuery } from "@tanstack/react-query"
import { formatTime } from "../lib/format.js"
import { useTRPC } from "../trpc.js"
import { EmptyState, ErrorState, LoadingState } from "./QueryState.js"

export const ChunksView = ({ id }: { id: string }) => {
  const trpc = useTRPC()
  const chunks = useQuery(trpc.exchanges.chunks.queryOptions({ id }))

  if (chunks.isPending) return <LoadingState label="Loading chunks" />
  if (chunks.error !== null) return <ErrorState message={chunks.error.message} />
  if ((chunks.data ?? []).length === 0) {
    return <EmptyState title="No chunks recorded" hint="This exchange has no captured SSE stream chunks." />
  }

  return (
    <ol className="chunklist">
      {(chunks.data ?? []).map((chunk) => (
        <li key={chunk.id} className="chunklist__item">
          <div className="chunklist__meta">
            #{chunk.sequence} · {formatTime(chunk.timestamp)}
          </div>
          <pre className="pre">{chunk.data}</pre>
        </li>
      ))}
    </ol>
  )
}
