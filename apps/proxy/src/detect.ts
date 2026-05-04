import type { Headers, ProviderFormat, Source } from "@llmviz/storage"

export interface Detection {
  readonly source: Source
  readonly provider_format: ProviderFormat
  readonly is_streaming: boolean
}

const PATH_FORMATS: ReadonlyArray<readonly [string, ProviderFormat]> = [
  ["/v1/messages", "anthropic"],
  ["/v1/complete", "anthropic"],
  ["/v1/chat/completions", "openai"],
  ["/v1/responses", "openai"],
  ["/v1/completions", "openai"],
  ["/v1/embeddings", "openai"]
]

const formatFromPath = (path: string): ProviderFormat | undefined =>
  PATH_FORMATS.find(([prefix]) => path.startsWith(prefix))?.[1]

const formatFromShape = (
  headers: Headers,
  body: Record<string, unknown> | undefined
): ProviderFormat | undefined => {
  if (headers["anthropic-version"] !== undefined) return "anthropic"
  if (body === undefined) return undefined
  if ("anthropic_version" in body || "system" in body) return "anthropic"
  if ("input" in body || "instructions" in body) return "openai"
  return undefined
}

const sourceFromUserAgent = (userAgent: string | undefined): Source | undefined => {
  if (userAgent === undefined) return undefined
  const ua = userAgent.toLowerCase()
  if (ua.includes("claude-cli") || ua.includes("claude-code")) return "claude-code"
  if (ua.includes("codex")) return "codex"
  return undefined
}

export const detect = (
  path: string,
  headers: Headers,
  body: Record<string, unknown> | undefined
): Detection => {
  const pathFormat = formatFromPath(path)
  const shapeFormat = formatFromShape(headers, body)
  const provider_format = pathFormat ?? shapeFormat ?? "openai"

  // Only infer the CLI from the request shape when the shape was actually recognised;
  // an unrecognised request stays `unknown` rather than being attributed to a CLI.
  const inferred = pathFormat ?? shapeFormat
  const source =
    sourceFromUserAgent(headers["user-agent"]) ??
    (inferred === "anthropic" ? "claude-code" : inferred === "openai" ? "codex" : "unknown")

  return { source, provider_format, is_streaming: body?.["stream"] === true }
}
