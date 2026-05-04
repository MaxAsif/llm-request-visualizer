import { useQuery } from "@tanstack/react-query"
import { ExchangeTable } from "../components/ExchangeTable.js"
import { EmptyState, ErrorState, LoadingState } from "../components/QueryState.js"
import { useTRPC } from "../trpc.js"

export const ExchangesView = ({ onSelect }: { onSelect: (id: string) => void }) => {
  const trpc = useTRPC()
  const exchanges = useQuery({
    ...trpc.exchanges.list.queryOptions({ limit: 200 }),
    refetchInterval: 2000
  })

  if (exchanges.isPending) return <LoadingState label="Loading exchanges" />
  if (exchanges.error !== null) return <ErrorState message={exchanges.error.message} />
  if (exchanges.data.length === 0) {
    return (
      <EmptyState
        title="No exchanges recorded yet"
        hint="Point Claude Code or Codex at the proxy, then send a request — it'll show up here."
      />
    )
  }

  return <ExchangeTable exchanges={exchanges.data} onSelect={onSelect} />
}
