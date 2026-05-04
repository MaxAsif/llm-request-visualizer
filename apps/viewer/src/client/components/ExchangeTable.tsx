import { formatDuration, formatTime } from "../lib/format.js"
import type { ExchangeSummary } from "../lib/types.js"
import { StatusChip } from "./StatusChip.js"

export const ExchangeTable = ({
  exchanges,
  onSelect
}: {
  exchanges: ReadonlyArray<ExchangeSummary>
  onSelect: (id: string) => void
}) => (
  <table className="table">
    <thead>
      <tr>
        <th />
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
      {exchanges.map((exchange) => (
        <tr key={exchange.id}>
          <td>
            <button type="button" className="btn-link" onClick={() => onSelect(exchange.id)}>
              open
            </button>
          </td>
          <td>{formatTime(exchange.timestampStart)}</td>
          <td>{exchange.source}</td>
          <td>{exchange.providerFormat}</td>
          <td>
            <code>{exchange.httpMethod}</code>
          </td>
          <td className="path">
            <code>{exchange.path}</code>
          </td>
          <td>
            <StatusChip exchange={exchange} />
          </td>
          <td>{exchange.isStreaming ? "yes" : "no"}</td>
          <td>{formatDuration(exchange)}</td>
        </tr>
      ))}
    </tbody>
  </table>
)
