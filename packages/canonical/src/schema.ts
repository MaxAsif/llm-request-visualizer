import { Schema } from "effect"

export const ContentBlock = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String
  }),
  Schema.Struct({
    type: Schema.Literal("thinking"),
    text: Schema.String,
    signature: Schema.NullOr(Schema.String)
  }),
  Schema.Struct({
    type: Schema.Literal("tool_use"),
    id: Schema.String,
    name: Schema.String,
    input: Schema.Unknown
  }),
  Schema.Struct({
    type: Schema.Literal("tool_result"),
    toolUseId: Schema.String,
    content: Schema.String,
    isError: Schema.Boolean
  }),
  /** Any block shape the canonical layer does not model yet, preserved verbatim. */
  Schema.Struct({
    type: Schema.Literal("unknown"),
    raw: Schema.Unknown
  })
)
export type ContentBlock = typeof ContentBlock.Type

export const Message = Schema.Struct({
  role: Schema.String,
  content: Schema.Array(ContentBlock)
})
export type Message = typeof Message.Type

export const ToolDefinition = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  inputSchema: Schema.Unknown
})
export type ToolDefinition = typeof ToolDefinition.Type

export const ToolCall = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown
})
export type ToolCall = typeof ToolCall.Type

export const ToolResult = Schema.Struct({
  toolUseId: Schema.String,
  content: Schema.String,
  isError: Schema.Boolean
})
export type ToolResult = typeof ToolResult.Type

export const ReasoningBlock = Schema.Struct({
  text: Schema.String,
  signature: Schema.NullOr(Schema.String)
})
export type ReasoningBlock = typeof ReasoningBlock.Type

export const CanonicalExchange = Schema.Struct({
  id: Schema.String,
  model: Schema.NullOr(Schema.String),
  systemPrompt: Schema.NullOr(Schema.String),
  /** The conversation sent in the request; the response is surfaced via the fields below. */
  messages: Schema.Array(Message),
  toolDefinitions: Schema.Array(ToolDefinition),
  /** Tool calls the model made in this exchange's response. */
  toolCalls: Schema.Array(ToolCall),
  /** Tool results the client supplied in this exchange's request. */
  toolResults: Schema.Array(ToolResult),
  reasoning: Schema.Array(ReasoningBlock),
  responseText: Schema.String,
  stopReason: Schema.NullOr(Schema.String),
  usage: Schema.Record({ key: Schema.String, value: Schema.Number }),
  extensions: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})
export type CanonicalExchange = typeof CanonicalExchange.Type
