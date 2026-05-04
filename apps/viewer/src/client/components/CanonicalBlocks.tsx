import { useState, type ReactNode } from "react"
import { roleClass } from "../lib/format.js"
import type { CanonicalExchange, ContentBlock } from "../lib/types.js"
import { UsageBar } from "./UsageBar.js"

export const Section = ({ title, children }: { title: string; children: ReactNode }) => {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <section className="section">
      <button type="button" className="section__header" onClick={() => setCollapsed(!collapsed)}>
        <h3 className="section__title">{title}</h3>
        <span className={`card__chevron${collapsed ? "" : " is-open"}`}>▸</span>
      </button>
      {collapsed ? null : children}
    </section>
  )
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Renders tool arguments as a key/value table when the input is a flat-ish object, JSON otherwise. */
const ToolArgs = ({ input }: { input: unknown }) => {
  if (!isPlainObject(input) || Object.keys(input).length === 0) {
    return <pre className="pre toolcard__json">{JSON.stringify(input, null, 2)}</pre>
  }
  return (
    <dl className="toolcard__args">
      {Object.entries(input).map(([key, value]) => (
        <div key={key} className="toolcard__arg">
          <dt>{key}</dt>
          <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export const Block = ({
  block,
  toolNameById
}: {
  block: ContentBlock
  toolNameById?: ReadonlyMap<string, string>
}) => {
  if (block.type === "text") return <pre className="pre block block--text">{block.text}</pre>

  if (block.type === "thinking") return <pre className="pre block block--thinking">{block.text}</pre>

  if (block.type === "tool_use") {
    return (
      <div className="toolcard toolcard--call">
        <div className="toolcard__header">
          <span className="toolcard__icon">→</span>
          <span className="toolcard__name">{block.name}</span>
          <code className="toolcard__id">{block.id}</code>
        </div>
        <ToolArgs input={block.input} />
      </div>
    )
  }

  if (block.type === "tool_result") {
    const name = toolNameById?.get(block.toolUseId)
    return (
      <div className={`toolcard toolcard--result${block.isError ? " is-error" : ""}`}>
        <div className="toolcard__header">
          <span className="toolcard__icon">←</span>
          {name !== undefined ? <span className="toolcard__name">{name}</span> : null}
          <code className="toolcard__id">{block.toolUseId}</code>
          {block.isError ? <span className="toolcard__badge">error</span> : null}
        </div>
        <pre className="pre toolcard__content">{block.content}</pre>
      </div>
    )
  }

  return <pre className="pre block block--unknown">{JSON.stringify(block.raw, null, 2)}</pre>
}

export const MessageList = ({
  messages,
  toolNameById
}: {
  messages: CanonicalExchange["messages"]
  toolNameById?: ReadonlyMap<string, string>
}) => (
  <>
    {messages.map((message, index) => (
      <div key={index} className="message">
        <span className={`message__role message__role--${roleClass(message.role)}`}>{message.role}</span>
        {message.content.map((block, blockIndex) => (
          <Block key={blockIndex} block={block} toolNameById={toolNameById} />
        ))}
      </div>
    ))}
  </>
)

export const ToolCallsSection = ({ calls }: { calls: CanonicalExchange["toolCalls"] }) =>
  calls.length === 0 ? null : (
    <Section title={`Tool calls (${calls.length})`}>
      {calls.map((call) => (
        <div key={call.id} className="toolcard toolcard--call">
          <div className="toolcard__header">
            <span className="toolcard__icon">→</span>
            <span className="toolcard__name">{call.name}</span>
            <code className="toolcard__id">{call.id}</code>
          </div>
          <ToolArgs input={call.input} />
        </div>
      ))}
    </Section>
  )

const buildToolNameById = (calls: CanonicalExchange["toolCalls"]): ReadonlyMap<string, string> =>
  new Map(calls.map((call) => [call.id, call.name]))

export const CanonicalView = ({ canonical }: { canonical: CanonicalExchange }) => {
  const toolNameById = buildToolNameById(canonical.toolCalls)

  return (
    <>
      <Section title="Overview">
        <div className="meta" style={{ border: "none", marginBottom: 0, paddingBottom: 0 }}>
          model <code>{canonical.model ?? "—"}</code>
          <span className="meta__sep">·</span>
          stop reason <code>{canonical.stopReason ?? "—"}</code>
        </div>
      </Section>
      {canonical.systemPrompt === null ? null : (
        <Section title="System prompt">
          <pre className="pre">{canonical.systemPrompt}</pre>
        </Section>
      )}
      <Section title={`Messages (${canonical.messages.length})`}>
        <MessageList messages={canonical.messages} toolNameById={toolNameById} />
      </Section>
      {canonical.reasoning.length === 0 ? null : (
        <Section title="Reasoning">
          {canonical.reasoning.map((entry, index) => (
            <pre key={index} className="pre block block--thinking">
              {entry.text}
            </pre>
          ))}
        </Section>
      )}
      <Section title="Response">
        <pre className="pre">{canonical.responseText === "" ? "—" : canonical.responseText}</pre>
      </Section>
      <ToolCallsSection calls={canonical.toolCalls} />
      {canonical.toolResults.length === 0 ? null : (
        <Section title={`Tool results (${canonical.toolResults.length})`}>
          {canonical.toolResults.map((result) => (
            <div key={result.toolUseId} className={`toolcard toolcard--result${result.isError ? " is-error" : ""}`}>
              <div className="toolcard__header">
                <span className="toolcard__icon">←</span>
                {toolNameById.get(result.toolUseId) !== undefined ? (
                  <span className="toolcard__name">{toolNameById.get(result.toolUseId)}</span>
                ) : null}
                <code className="toolcard__id">{result.toolUseId}</code>
                {result.isError ? <span className="toolcard__badge">error</span> : null}
              </div>
              <pre className="pre toolcard__content">{result.content}</pre>
            </div>
          ))}
        </Section>
      )}
      {canonical.toolDefinitions.length === 0 ? null : (
        <Section title={`Tool definitions (${canonical.toolDefinitions.length})`}>
          <pre className="pre">{canonical.toolDefinitions.map((tool) => tool.name).join(", ")}</pre>
        </Section>
      )}
      <Section title="Usage">
        <UsageBar usage={canonical.usage} />
      </Section>
    </>
  )
}
