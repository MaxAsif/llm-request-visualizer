import type { Chunk, Exchange } from "@llmviz/storage"
import {
  asArray,
  asNumberOrNull,
  asString,
  asStringOrNull,
  decodeBody,
  isRecord,
  type Json,
  omit
} from "./json.js"
import type {
  CanonicalExchange,
  ContentBlock,
  Message,
  ReasoningBlock,
  ToolCall,
  ToolDefinition,
  ToolResult
} from "./schema.js"
import { reconstructStream } from "./sse.js"

const REQUEST_MODELLED_KEYS = ["model", "system", "messages", "tools"]
const RESPONSE_MODELLED_KEYS = ["model", "content", "stop_reason", "usage"]

const flattenToolResultContent = (value: unknown): string => {
  if (typeof value === "string") return value
  return asArray(value)
    .map((block) =>
      isRecord(block) && block["type"] === "text" ? asString(block["text"]) : JSON.stringify(block)
    )
    .join("\n")
}

const normalizeBlock = (raw: unknown): ContentBlock => {
  if (!isRecord(raw)) return { type: "unknown", raw }
  switch (raw["type"]) {
    case "text":
      return { type: "text", text: asString(raw["text"]) }
    case "thinking":
      return {
        type: "thinking",
        text: asString(raw["thinking"]),
        signature: asStringOrNull(raw["signature"])
      }
    case "tool_use":
      return {
        type: "tool_use",
        id: asString(raw["id"]),
        name: asString(raw["name"]),
        input: raw["input"] ?? null
      }
    case "tool_result":
      return {
        type: "tool_result",
        toolUseId: asString(raw["tool_use_id"]),
        content: flattenToolResultContent(raw["content"]),
        isError: raw["is_error"] === true
      }
    default:
      return { type: "unknown", raw }
  }
}

const normalizeContent = (value: unknown): ReadonlyArray<ContentBlock> =>
  typeof value === "string"
    ? [{ type: "text", text: value }]
    : asArray(value).map(normalizeBlock)

const normalizeMessages = (value: unknown): ReadonlyArray<Message> =>
  asArray(value)
    .filter(isRecord)
    .map((message) => ({
      role: asString(message["role"]),
      content: normalizeContent(message["content"])
    }))

const normalizeSystemPrompt = (value: unknown): string | null => {
  if (typeof value === "string") return value
  const blocks = asArray(value)
  if (blocks.length === 0) return null
  return blocks
    .map((block) => (isRecord(block) ? asString(block["text"]) : ""))
    .join("\n")
}

const normalizeToolDefinitions = (value: unknown): ReadonlyArray<ToolDefinition> =>
  asArray(value)
    .filter(isRecord)
    .map((tool) => ({
      name: asString(tool["name"]),
      description: asStringOrNull(tool["description"]),
      inputSchema: tool["input_schema"] ?? null
    }))

const normalizeUsage = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {}
  const usage: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    const numeric = asNumberOrNull(entry)
    if (numeric !== null) usage[key] = numeric
  }
  return usage
}

export const normalize = (
  exchange: Exchange,
  chunks: ReadonlyArray<Chunk> = []
): CanonicalExchange => {
  const request = decodeBody(exchange.request_body)
  const response: Json = exchange.is_streaming
    ? reconstructStream(chunks)
    : decodeBody(exchange.response_body)

  const requestMessages = normalizeMessages(request["messages"])
  const responseBlocks = normalizeContent(response["content"])

  const toolCalls: ToolCall[] = []
  const reasoning: ReasoningBlock[] = []
  let responseText = ""
  for (const block of responseBlocks) {
    if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, input: block.input })
    else if (block.type === "thinking") reasoning.push({ text: block.text, signature: block.signature })
    else if (block.type === "text") responseText += block.text
  }

  const toolResults: ToolResult[] = []
  for (const message of requestMessages) {
    for (const block of message.content) {
      if (block.type === "tool_result") {
        toolResults.push({
          toolUseId: block.toolUseId,
          content: block.content,
          isError: block.isError
        })
      }
    }
  }

  return {
    id: exchange.id,
    model: asStringOrNull(response["model"] ?? request["model"]),
    systemPrompt: normalizeSystemPrompt(request["system"]),
    messages: requestMessages,
    toolDefinitions: normalizeToolDefinitions(request["tools"]),
    toolCalls,
    toolResults,
    reasoning,
    responseText,
    stopReason: asStringOrNull(response["stop_reason"]),
    usage: normalizeUsage(response["usage"]),
    extensions: {
      request: omit(request, REQUEST_MODELLED_KEYS),
      response: omit(response, RESPONSE_MODELLED_KEYS)
    }
  }
}
