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
import { chunkText, parseEvents } from "./sse.js"

const CHAT_REQUEST_MODELLED_KEYS = ["model", "messages", "tools"]
const CHAT_RESPONSE_MODELLED_KEYS = ["model", "choices", "usage"]
const RESPONSES_REQUEST_MODELLED_KEYS = ["model", "instructions", "input", "tools"]
const RESPONSES_RESPONSE_MODELLED_KEYS = [
  "model",
  "output",
  "status",
  "incomplete_details",
  "usage"
]

const SYSTEM_ROLES = ["system", "developer"]

const flattenText = (value: unknown): string => {
  if (typeof value === "string") return value
  return asArray(value)
    .map((part) =>
      isRecord(part) && typeof part["text"] === "string" ? part["text"] : JSON.stringify(part)
    )
    .join("\n")
}

const parseArguments = (value: unknown): unknown => {
  const text = asString(value)
  if (text.length === 0) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/** Nested breakdowns (`prompt_tokens_details`, `output_tokens_details`, …) keep their parent key as a prefix. */
const normalizeUsage = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {}
  const usage: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    const numeric = asNumberOrNull(entry)
    if (numeric !== null) {
      usage[key] = numeric
      continue
    }
    if (!isRecord(entry)) continue
    for (const [nestedKey, nestedEntry] of Object.entries(entry)) {
      const nested = asNumberOrNull(nestedEntry)
      if (nested !== null) usage[`${key}.${nestedKey}`] = nested
    }
  }
  return usage
}

/** Chat Completions nests the schema under `function`; the Responses API keeps it flat. */
const normalizeToolDefinitions = (value: unknown): ReadonlyArray<ToolDefinition> =>
  asArray(value)
    .filter(isRecord)
    .map((tool) => {
      const fn = isRecord(tool["function"]) ? tool["function"] : tool
      const name = asString(fn["name"])
      return {
        name: name.length === 0 ? asString(tool["type"]) : name,
        description: asStringOrNull(fn["description"]),
        inputSchema: fn["parameters"] ?? null
      }
    })

const joinOrNull = (parts: ReadonlyArray<string>): string | null =>
  parts.length === 0 ? null : parts.join("\n")

const splitResponse = (blocks: ReadonlyArray<ContentBlock>) => {
  const toolCalls: ToolCall[] = []
  const reasoning: ReasoningBlock[] = []
  let responseText = ""
  for (const block of blocks) {
    if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, input: block.input })
    else if (block.type === "thinking") reasoning.push({ text: block.text, signature: block.signature })
    else if (block.type === "text") responseText += block.text
  }
  return { toolCalls, reasoning, responseText }
}

const collectToolResults = (messages: ReadonlyArray<Message>): ReadonlyArray<ToolResult> => {
  const toolResults: ToolResult[] = []
  for (const message of messages) {
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
  return toolResults
}

const isSystemRole = (message: Json): boolean => SYSTEM_ROLES.includes(asString(message["role"]))

const normalizeChatContent = (value: unknown): ReadonlyArray<ContentBlock> => {
  if (typeof value === "string") return value.length === 0 ? [] : [{ type: "text", text: value }]
  return asArray(value).map((part) =>
    isRecord(part) && part["type"] === "text"
      ? { type: "text", text: asString(part["text"]) }
      : { type: "unknown", raw: part }
  )
}

const chatToolCallBlock = (call: Json): ContentBlock => {
  const fn = isRecord(call["function"]) ? call["function"] : {}
  return {
    type: "tool_use",
    id: asString(call["id"]),
    name: asString(fn["name"]),
    input: parseArguments(fn["arguments"])
  }
}

const normalizeChatMessage = (message: Json): Message => {
  const role = asString(message["role"])
  if (role === "tool") {
    return {
      role,
      content: [
        {
          type: "tool_result",
          toolUseId: asString(message["tool_call_id"]),
          content: flattenText(message["content"]),
          isError: false
        }
      ]
    }
  }
  return {
    role,
    content: [
      ...normalizeChatContent(message["content"]),
      ...asArray(message["tool_calls"]).filter(isRecord).map(chatToolCallBlock)
    ]
  }
}

const normalizeChat = (exchange: Exchange, request: Json, response: Json): CanonicalExchange => {
  const requestMessages = asArray(request["messages"]).filter(isRecord)
  const choice = asArray(response["choices"]).filter(isRecord)[0] ?? {}
  const responseMessage = isRecord(choice["message"]) ? choice["message"] : {}

  const messages = requestMessages.filter((message) => !isSystemRole(message)).map(normalizeChatMessage)
  const { reasoning, responseText, toolCalls } = splitResponse(
    normalizeChatMessage(responseMessage).content
  )

  return {
    id: exchange.id,
    model: asStringOrNull(response["model"] ?? request["model"]),
    systemPrompt: joinOrNull(
      requestMessages.filter(isSystemRole).map((message) => flattenText(message["content"]))
    ),
    messages,
    toolDefinitions: normalizeToolDefinitions(request["tools"]),
    toolCalls,
    toolResults: collectToolResults(messages),
    reasoning,
    responseText,
    stopReason: asStringOrNull(choice["finish_reason"]),
    usage: normalizeUsage(response["usage"]),
    extensions: {
      request: omit(request, CHAT_REQUEST_MODELLED_KEYS),
      response: omit(response, CHAT_RESPONSE_MODELLED_KEYS)
    }
  }
}

const callId = (item: Json): string => {
  const id = asString(item["call_id"])
  return id.length === 0 ? asString(item["id"]) : id
}

const reasoningText = (item: Json): string =>
  asArray(item["summary"])
    .map((part) => (isRecord(part) ? asString(part["text"]) : ""))
    .join("\n")

const normalizeResponsesContent = (value: unknown): ReadonlyArray<ContentBlock> => {
  if (typeof value === "string") return value.length === 0 ? [] : [{ type: "text", text: value }]
  return asArray(value).map((part) => {
    if (!isRecord(part)) return { type: "unknown", raw: part }
    switch (part["type"]) {
      case "input_text":
      case "output_text":
        return { type: "text", text: asString(part["text"]) }
      default:
        return { type: "unknown", raw: part }
    }
  })
}

/**
 * The Responses API is a flat item stream rather than a message list, so each non-message
 * item is lifted into a synthetic message that preserves its position in the conversation.
 */
const normalizeResponsesItem = (item: Json): Message => {
  switch (item["type"]) {
    case "function_call":
      return {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: callId(item),
            name: asString(item["name"]),
            input: parseArguments(item["arguments"])
          }
        ]
      }
    case "function_call_output":
      return {
        role: "tool",
        content: [
          {
            type: "tool_result",
            toolUseId: callId(item),
            content: flattenText(item["output"]),
            isError: false
          }
        ]
      }
    case "reasoning":
      return {
        role: "assistant",
        content: [
          {
            type: "thinking",
            text: reasoningText(item),
            signature: asStringOrNull(item["encrypted_content"])
          }
        ]
      }
    case "message":
    case undefined:
      return { role: asString(item["role"]), content: normalizeResponsesContent(item["content"]) }
    default:
      return { role: asString(item["role"]), content: [{ type: "unknown", raw: item }] }
  }
}

const normalizeResponsesInput = (value: unknown): ReadonlyArray<Message> =>
  typeof value === "string"
    ? [{ role: "user", content: [{ type: "text", text: value }] }]
    : asArray(value).filter(isRecord).map(normalizeResponsesItem)

const normalizeResponses = (
  exchange: Exchange,
  request: Json,
  response: Json
): CanonicalExchange => {
  const inputMessages = normalizeResponsesInput(request["input"])
  const messages = inputMessages.filter((message) => !SYSTEM_ROLES.includes(message.role))
  const { reasoning, responseText, toolCalls } = splitResponse(
    asArray(response["output"]).filter(isRecord).flatMap((item) => normalizeResponsesItem(item).content)
  )

  const incomplete = response["incomplete_details"]
  const systemParts = [
    ...(typeof request["instructions"] === "string" ? [request["instructions"]] : []),
    ...inputMessages
      .filter((message) => SYSTEM_ROLES.includes(message.role))
      .map((message) => message.content.map((block) => (block.type === "text" ? block.text : "")).join("\n"))
  ]

  return {
    id: exchange.id,
    model: asStringOrNull(response["model"] ?? request["model"]),
    systemPrompt: joinOrNull(systemParts),
    messages,
    toolDefinitions: normalizeToolDefinitions(request["tools"]),
    toolCalls,
    toolResults: collectToolResults(messages),
    reasoning,
    responseText,
    stopReason: isRecord(incomplete)
      ? asStringOrNull(incomplete["reason"])
      : asStringOrNull(response["status"]),
    usage: normalizeUsage(response["usage"]),
    extensions: {
      request: omit(request, RESPONSES_REQUEST_MODELLED_KEYS),
      response: omit(response, RESPONSES_RESPONSE_MODELLED_KEYS)
    }
  }
}

const reconstructChatStream = (events: ReadonlyArray<Json>): Json => {
  const completion: Json = {}
  const message: Json = { role: "assistant", content: "" }
  const toolCalls = new Map<number, Json>()
  const toolArguments = new Map<number, string>()
  let finishReason: string | null = null

  for (const event of events) {
    for (const [key, value] of Object.entries(event)) {
      if (key !== "choices" && key !== "object" && value !== null) completion[key] = value
    }

    const choice = asArray(event["choices"]).filter(isRecord)[0]
    if (choice === undefined) continue
    finishReason = asStringOrNull(choice["finish_reason"]) ?? finishReason

    const delta = choice["delta"]
    if (!isRecord(delta)) continue
    if (typeof delta["role"] === "string") message["role"] = delta["role"]
    if (typeof delta["content"] === "string") {
      message["content"] = asString(message["content"]) + delta["content"]
    }

    for (const call of asArray(delta["tool_calls"]).filter(isRecord)) {
      const index = asNumberOrNull(call["index"]) ?? 0
      const existing = toolCalls.get(index) ?? { id: "", type: "function", function: { name: "" } }
      const fn = isRecord(existing["function"]) ? existing["function"] : {}
      const incoming = isRecord(call["function"]) ? call["function"] : {}
      if (typeof call["id"] === "string") existing["id"] = call["id"]
      if (typeof incoming["name"] === "string") fn["name"] = incoming["name"]
      existing["function"] = fn
      toolCalls.set(index, existing)
      toolArguments.set(index, (toolArguments.get(index) ?? "") + asString(incoming["arguments"]))
    }
  }

  if (toolCalls.size > 0) {
    message["tool_calls"] = [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        ...call,
        function: {
          ...(isRecord(call["function"]) ? call["function"] : {}),
          arguments: toolArguments.get(index) ?? ""
        }
      }))
  }

  completion["object"] = "chat.completion"
  completion["choices"] = [{ index: 0, message, finish_reason: finishReason }]
  return completion
}

const partAt = (item: Json, key: string, index: number, seed: Json): Json => {
  const list = Array.isArray(item[key]) ? (item[key] as Array<unknown>) : []
  item[key] = list
  while (list.length <= index) list.push({ ...seed })
  const existing = list[index]
  if (isRecord(existing)) return existing
  const created = { ...seed }
  list[index] = created
  return created
}

const reconstructResponsesStream = (events: ReadonlyArray<Json>): Json => {
  let response: Json = {}
  const items = new Map<number, Json>()

  const itemAt = (event: Json): Json | undefined => {
    const index = asNumberOrNull(event["output_index"])
    return index === null ? undefined : items.get(index)
  }

  for (const event of events) {
    const type = asString(event["type"])
    if (type.startsWith("response.") && isRecord(event["response"])) {
      response = { ...response, ...event["response"] }
      continue
    }

    switch (type) {
      case "response.output_item.added":
      case "response.output_item.done": {
        const index = asNumberOrNull(event["output_index"])
        const item = event["item"]
        if (index === null || !isRecord(item)) break
        items.set(index, { ...item })
        break
      }

      case "response.output_text.delta": {
        const item = itemAt(event)
        if (item === undefined) break
        const part = partAt(item, "content", asNumberOrNull(event["content_index"]) ?? 0, {
          type: "output_text",
          text: ""
        })
        part["text"] = asString(part["text"]) + asString(event["delta"])
        break
      }

      case "response.reasoning_summary_text.delta": {
        const item = itemAt(event)
        if (item === undefined) break
        const part = partAt(item, "summary", asNumberOrNull(event["summary_index"]) ?? 0, {
          type: "summary_text",
          text: ""
        })
        part["text"] = asString(part["text"]) + asString(event["delta"])
        break
      }

      case "response.function_call_arguments.delta": {
        const item = itemAt(event)
        if (item === undefined) break
        item["arguments"] = asString(item["arguments"]) + asString(event["delta"])
        break
      }
    }
  }

  // A terminal `response.completed` carries the full output; deltas only matter for truncated streams.
  if (asArray(response["output"]).length === 0) {
    response["output"] = [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item)
  }
  return response
}

const usesResponsesApi = (exchange: Exchange, request: Json, response: Json): boolean =>
  exchange.path.includes("/responses") ||
  "input" in request ||
  "instructions" in request ||
  "output" in response ||
  response["object"] === "response"

export const reconstructStream = (chunks: ReadonlyArray<Chunk>): Json => {
  const events = parseEvents(chunkText(chunks))
  return events.some((event) => asString(event["type"]).startsWith("response."))
    ? reconstructResponsesStream(events)
    : reconstructChatStream(events)
}

export const normalize = (
  exchange: Exchange,
  chunks: ReadonlyArray<Chunk> = []
): CanonicalExchange => {
  const request = decodeBody(exchange.request_body)
  const response: Json = exchange.is_streaming
    ? reconstructStream(chunks)
    : decodeBody(exchange.response_body)

  return usesResponsesApi(exchange, request, response)
    ? normalizeResponses(exchange, request, response)
    : normalizeChat(exchange, request, response)
}
