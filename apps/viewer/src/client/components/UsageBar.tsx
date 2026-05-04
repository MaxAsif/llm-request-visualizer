const PALETTE = [
  "var(--accent-blue)",
  "var(--accent-violet)",
  "var(--accent-amber)",
  "var(--accent-teal)",
  "var(--accent-cyan)",
  "var(--accent-coral)"
]

/** A "total"-shaped key would double-count against its own parts in the bar, so it's dropped from the visual and shown only in the legend value list is skipped too — simplest correct behavior is to just exclude exact "total_tokens" / "total" keys from the proportional bar. */
const isTotalKey = (key: string): boolean => key === "total_tokens" || key === "total"

export const UsageBar = ({ usage }: { usage: Readonly<Record<string, number>> }) => {
  const entries = Object.entries(usage).filter(([, value]) => value > 0)
  if (entries.length === 0) return <p className="pre pre--muted">—</p>

  const barEntries = entries.filter(([key]) => !isTotalKey(key))
  const sum = barEntries.reduce((total, [, value]) => total + value, 0)

  return (
    <div className="usage">
      {sum > 0 ? (
        <div className="usage__bar">
          {barEntries.map(([key, value], index) => (
            <span
              key={key}
              className="usage__segment"
              style={{ width: `${(value / sum) * 100}%`, background: PALETTE[index % PALETTE.length] }}
              title={`${key}: ${value}`}
            />
          ))}
        </div>
      ) : null}
      <div className="usage__legend">
        {entries.map(([key, value], index) => (
          <span key={key} className="usage__legend-item">
            {isTotalKey(key) ? null : (
              <span
                className="usage__swatch"
                style={{ background: PALETTE[index % PALETTE.length] }}
              />
            )}
            {key}: <code>{value.toLocaleString()}</code>
          </span>
        ))}
      </div>
    </div>
  )
}
