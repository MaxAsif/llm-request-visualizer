import type { ExchangeSummary } from "../../server/router.js"
import { statusKind, statusLabel } from "../lib/format.js"

const kindClass: Record<string, string> = {
  ok: "chip chip--ok",
  warn: "chip chip--warn",
  err: "chip chip--err",
  pending: "chip chip--pending"
}

export const StatusChip = ({ exchange }: { exchange: ExchangeSummary }) => (
  <span className={kindClass[statusKind(exchange)]}>
    <span className="chip__dot" />
    {statusLabel(exchange)}
  </span>
)

export const StreamChip = ({ streaming }: { streaming: boolean }) =>
  streaming ? (
    <span className="chip chip--ok chip--stream">
      <span className="chip__dot" />
      streaming
    </span>
  ) : (
    <span className="chip chip--pending">complete</span>
  )
