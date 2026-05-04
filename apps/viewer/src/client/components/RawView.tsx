import { prettyJson } from "../lib/format.js"
import type { RawPayload } from "../lib/types.js"
import { Section } from "./CanonicalBlocks.js"

const HeaderTable = ({ headers }: { headers: Readonly<Record<string, string>> }) => (
  <pre className="pre">
    {Object.entries(headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n") || "—"}
  </pre>
)

export const RawView = ({ raw }: { raw: RawPayload }) => (
  <>
    <Section title="Request headers">
      <HeaderTable headers={raw.requestHeaders} />
    </Section>
    <Section title="Request body">
      <pre className="pre">{prettyJson(raw.requestBody)}</pre>
    </Section>
    <Section title="Response headers">
      {raw.responseHeaders === null ? <pre className="pre">—</pre> : <HeaderTable headers={raw.responseHeaders} />}
    </Section>
    <Section title="Response body">
      <pre className="pre">{raw.responseBody === null ? "—" : prettyJson(raw.responseBody)}</pre>
    </Section>
  </>
)
