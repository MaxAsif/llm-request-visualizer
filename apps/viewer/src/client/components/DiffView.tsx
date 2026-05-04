import type { CanonicalExchange, SessionExchange } from "../lib/types.js"
import { MessageList, Section, ToolCallsSection } from "./CanonicalBlocks.js"

export const DiffView = ({
  canonical,
  diff
}: {
  canonical: CanonicalExchange
  diff: NonNullable<SessionExchange["diff"]>
}) => (
  <>
    {diff.systemPromptChanged ? (
      <Section title="System prompt (changed)">
        <pre className="pre">{canonical.systemPrompt ?? "—"}</pre>
      </Section>
    ) : null}
    <Section
      title={`New in this turn (${diff.newMessages.length} message${diff.newMessages.length === 1 ? "" : "s"})`}
    >
      {diff.unchangedMessages > 0 ? (
        <div className="fold">
          <span>⋯</span>
          {diff.unchangedMessages} unchanged message{diff.unchangedMessages === 1 ? "" : "s"} collapsed
        </div>
      ) : null}
      {diff.diverged ? (
        <div className="diverged-banner">
          ⚠ Diverged from the previous exchange — earlier messages were dropped or rewritten.
        </div>
      ) : null}
      {diff.newMessages.length === 0 ? (
        <p className="pre pre--muted" style={{ background: "none", border: "none", padding: 0 }}>
          No new request messages.
        </p>
      ) : (
        <MessageList messages={diff.newMessages} />
      )}
    </Section>
    <Section title="Response">
      <pre className="pre">{canonical.responseText === "" ? "—" : canonical.responseText}</pre>
    </Section>
    <ToolCallsSection calls={canonical.toolCalls} />
  </>
)
