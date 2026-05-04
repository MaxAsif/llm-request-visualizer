import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { normalize } from "../src/anthropic.js"
import { CanonicalExchange } from "../src/schema.js"
import {
  encode,
  makeChunks,
  makeExchange,
  streamingEvents,
  toolUseRequest,
  toolUseResponse
} from "./fixtures.js"

const decodeCanonical = Schema.decodeUnknownSync(CanonicalExchange)

describe("non-streaming", () => {
  const exchange = makeExchange({
    request_body: encode(toolUseRequest),
    response_body: encode(toolUseResponse)
  })
  const canonical = normalize(exchange)

  it("produces a value matching the CanonicalExchange schema", () => {
    expect(decodeCanonical(canonical)).toStrictEqual(canonical)
  })

  it("extracts model, system prompt and stop reason", () => {
    expect(canonical.model).toBe("claude-opus-5")
    expect(canonical.systemPrompt).toBe("You are a coding assistant.")
    expect(canonical.stopReason).toBe("end_turn")
  })

  it("separates reasoning from response text", () => {
    expect(canonical.reasoning).toStrictEqual([{ text: "The tool says 18C.", signature: "sig-abc" }])
    expect(canonical.responseText).toBe("It is 18C and raining in Paris.")
  })

  it("extracts tool definitions and tool results", () => {
    expect(canonical.toolDefinitions).toStrictEqual([
      {
        name: "get_weather",
        description: "Get current weather for a location",
        inputSchema: toolUseRequest.tools[0]!.input_schema
      }
    ])
    expect(canonical.toolResults).toStrictEqual([
      { toolUseId: "toolu_01", content: "18C and raining", isError: false }
    ])
    expect(canonical.toolCalls).toStrictEqual([])
  })

  it("normalizes string and block message content alike", () => {
    expect(canonical.messages[0]).toStrictEqual({
      role: "user",
      content: [{ type: "text", text: "What's the weather in Paris?" }]
    })
    expect(canonical.messages[1]?.content[0]).toStrictEqual({
      type: "tool_use",
      id: "toolu_01",
      name: "get_weather",
      input: { location: "Paris" }
    })
  })

  it("carries cache usage fields through the open usage map", () => {
    expect(canonical.usage).toStrictEqual({
      input_tokens: 1024,
      output_tokens: 42,
      cache_creation_input_tokens: 512,
      cache_read_input_tokens: 2048
    })
  })

  it("preserves unmodelled fields in extensions", () => {
    expect(canonical.extensions["request"]).toStrictEqual({ max_tokens: 4096 })
    expect(canonical.extensions["response"]).toStrictEqual({
      id: "msg_01",
      type: "message",
      role: "assistant",
      stop_sequence: null
    })
  })
})

describe("streaming", () => {
  const exchange = makeExchange({
    id: "ex-stream",
    is_streaming: true,
    request_body: encode({ model: "claude-opus-5", stream: true, messages: [] }),
    response_headers: { "content-type": "text/event-stream" }
  })
  const canonical = normalize(exchange, makeChunks(exchange.id, streamingEvents))

  it("produces a value matching the CanonicalExchange schema", () => {
    expect(decodeCanonical(canonical)).toStrictEqual(canonical)
  })

  it("reconstructs text and thinking deltas into complete blocks", () => {
    expect(canonical.responseText).toBe("Let me check the weather.")
    expect(canonical.reasoning).toStrictEqual([
      { text: "Need the forecast.", signature: "sig-stream" }
    ])
  })

  it("reconstructs tool_use input from partial JSON deltas", () => {
    expect(canonical.toolCalls).toStrictEqual([
      { id: "toolu_02", name: "get_weather", input: { location: "Tokyo" } }
    ])
  })

  it("applies message_delta stop reason and merges cumulative usage", () => {
    expect(canonical.stopReason).toBe("tool_use")
    expect(canonical.usage).toStrictEqual({
      input_tokens: 300,
      output_tokens: 57,
      cache_read_input_tokens: 4096
    })
  })

  it("ignores chunk arrival order in favour of sequence", () => {
    const shuffled = [...makeChunks(exchange.id, streamingEvents)].reverse()
    expect(normalize(exchange, shuffled)).toStrictEqual(canonical)
  })
})

describe("degenerate exchanges", () => {
  it("normalizes an in-flight exchange with no response", () => {
    const canonical = normalize(makeExchange({ response_body: null, response_complete: false }))
    expect(canonical.responseText).toBe("")
    expect(canonical.stopReason).toBeNull()
    expect(canonical.usage).toStrictEqual({})
  })

  it("preserves unknown content block shapes verbatim", () => {
    const block = { type: "server_tool_use", id: "srvtoolu_01", name: "web_search" }
    const canonical = normalize(
      makeExchange({
        request_body: encode({ messages: [{ role: "assistant", content: [block] }] })
      })
    )
    expect(canonical.messages[0]?.content[0]).toStrictEqual({ type: "unknown", raw: block })
  })
})
