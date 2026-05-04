import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { normalize } from "../src/openai.js"
import { CanonicalExchange } from "../src/schema.js"
import { encode, makeChunks, makeDataChunks, makeExchange } from "./fixtures.js"
import {
  chatRequest,
  chatResponse,
  chatStreamChunks,
  responsesCompletedEvent,
  responsesRequest,
  responsesResponse,
  responsesStreamEvents
} from "./openai-fixtures.js"

const decodeCanonical = Schema.decodeUnknownSync(CanonicalExchange)

const makeChatExchange = (overrides = {}) =>
  makeExchange({
    source: "codex",
    provider_format: "openai",
    path: "/v1/chat/completions",
    upstream_host: "api.openai.com",
    ...overrides
  })

const makeResponsesExchange = (overrides = {}) =>
  makeExchange({
    source: "codex",
    provider_format: "openai",
    path: "/v1/responses",
    upstream_host: "api.openai.com",
    ...overrides
  })

describe("chat completions, non-streaming", () => {
  const exchange = makeChatExchange({
    request_body: encode(chatRequest),
    response_body: encode(chatResponse)
  })
  const canonical = normalize(exchange)

  it("produces a value matching the CanonicalExchange schema", () => {
    expect(decodeCanonical(canonical)).toStrictEqual(canonical)
  })

  it("lifts system messages out of the conversation into systemPrompt", () => {
    expect(canonical.systemPrompt).toBe("You are a coding assistant.")
    expect(canonical.messages.map((message) => message.role)).toStrictEqual([
      "user",
      "assistant",
      "tool"
    ])
  })

  it("extracts model and finish reason", () => {
    expect(canonical.model).toBe("gpt-5-codex")
    expect(canonical.stopReason).toBe("stop")
  })

  it("normalizes assistant tool_calls into tool_use blocks", () => {
    expect(canonical.messages[1]?.content).toStrictEqual([
      { type: "tool_use", id: "call_01", name: "get_weather", input: { location: "Paris" } }
    ])
  })

  it("extracts tool definitions from the nested function shape", () => {
    expect(canonical.toolDefinitions).toStrictEqual([
      {
        name: "get_weather",
        description: "Get current weather for a location",
        inputSchema: chatRequest.tools[0]!.function.parameters
      }
    ])
  })

  it("extracts tool results from role:tool messages", () => {
    expect(canonical.toolResults).toStrictEqual([
      { toolUseId: "call_01", content: "18C and raining", isError: false }
    ])
    expect(canonical.toolCalls).toStrictEqual([])
  })

  it("reads the response text off the first choice", () => {
    expect(canonical.responseText).toBe("It is 18C and raining in Paris.")
    expect(canonical.reasoning).toStrictEqual([])
  })

  it("flattens nested usage breakdowns into the open usage map", () => {
    expect(canonical.usage).toStrictEqual({
      prompt_tokens: 1024,
      completion_tokens: 42,
      total_tokens: 1066,
      "prompt_tokens_details.cached_tokens": 512,
      "completion_tokens_details.reasoning_tokens": 128
    })
  })

  it("preserves unmodelled fields in extensions", () => {
    expect(canonical.extensions["request"]).toStrictEqual({ temperature: 0.2 })
    expect(canonical.extensions["response"]).toStrictEqual({
      id: "chatcmpl_01",
      object: "chat.completion",
      created: 1_700_000_000,
      system_fingerprint: "fp_01"
    })
  })
})

describe("chat completions, streaming", () => {
  const exchange = makeChatExchange({
    id: "ex-chat-stream",
    is_streaming: true,
    request_body: encode({ model: "gpt-5-codex", stream: true, messages: [] }),
    response_headers: { "content-type": "text/event-stream" }
  })
  const canonical = normalize(exchange, makeDataChunks(exchange.id, chatStreamChunks))

  it("produces a value matching the CanonicalExchange schema", () => {
    expect(decodeCanonical(canonical)).toStrictEqual(canonical)
  })

  it("concatenates content deltas into the response text", () => {
    expect(canonical.responseText).toBe("Let me check the weather.")
  })

  it("reconstructs tool call arguments from partial JSON deltas", () => {
    expect(canonical.toolCalls).toStrictEqual([
      { id: "call_02", name: "get_weather", input: { location: "Tokyo" } }
    ])
  })

  it("applies the finish reason and the usage-only trailing chunk", () => {
    expect(canonical.stopReason).toBe("tool_calls")
    expect(canonical.usage).toStrictEqual({
      prompt_tokens: 300,
      completion_tokens: 57,
      total_tokens: 357
    })
  })

  it("ignores chunk arrival order in favour of sequence", () => {
    const shuffled = [...makeDataChunks(exchange.id, chatStreamChunks)].reverse()
    expect(normalize(exchange, shuffled)).toStrictEqual(canonical)
  })
})

describe("responses api, non-streaming", () => {
  const exchange = makeResponsesExchange({
    request_body: encode(responsesRequest),
    response_body: encode(responsesResponse)
  })
  const canonical = normalize(exchange)

  it("produces a value matching the CanonicalExchange schema", () => {
    expect(decodeCanonical(canonical)).toStrictEqual(canonical)
  })

  it("reads the system prompt from instructions", () => {
    expect(canonical.systemPrompt).toBe("You are a coding assistant.")
    expect(canonical.model).toBe("gpt-5-codex")
    expect(canonical.stopReason).toBe("completed")
  })

  it("lifts each input item into a positioned message", () => {
    expect(canonical.messages).toStrictEqual([
      { role: "user", content: [{ type: "text", text: "What's the weather in Paris?" }] },
      {
        role: "assistant",
        content: [{ type: "thinking", text: "I should call the weather tool.", signature: "enc-abc" }]
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_01", name: "get_weather", input: { location: "Paris" } }]
      },
      {
        role: "tool",
        content: [{ type: "tool_result", toolUseId: "call_01", content: "18C and raining", isError: false }]
      }
    ])
  })

  it("extracts tool definitions from the flat responses shape", () => {
    expect(canonical.toolDefinitions).toStrictEqual([
      {
        name: "get_weather",
        description: "Get current weather for a location",
        inputSchema: responsesRequest.tools[0]!.parameters
      }
    ])
  })

  it("extracts function_call_output items as tool results", () => {
    expect(canonical.toolResults).toStrictEqual([
      { toolUseId: "call_01", content: "18C and raining", isError: false }
    ])
  })

  it("separates reasoning summaries from response text", () => {
    expect(canonical.reasoning).toStrictEqual([{ text: "The tool says 18C.", signature: "enc-def" }])
    expect(canonical.responseText).toBe("It is 18C and raining in Paris.")
  })

  it("flattens nested usage breakdowns into the open usage map", () => {
    expect(canonical.usage).toStrictEqual({
      input_tokens: 1024,
      output_tokens: 42,
      total_tokens: 1066,
      "input_tokens_details.cached_tokens": 512,
      "output_tokens_details.reasoning_tokens": 128
    })
  })

  it("preserves unmodelled fields in extensions", () => {
    expect(canonical.extensions["request"]).toStrictEqual({
      store: false,
      previous_response_id: "resp_00"
    })
    expect(canonical.extensions["response"]).toStrictEqual({
      id: "resp_01",
      object: "response",
      created_at: 1_700_000_000,
      previous_response_id: "resp_00"
    })
  })
})

describe("responses api, streaming", () => {
  const exchange = makeResponsesExchange({
    id: "ex-responses-stream",
    is_streaming: true,
    request_body: encode({ model: "gpt-5-codex", stream: true, input: [] }),
    response_headers: { "content-type": "text/event-stream" }
  })
  const events = [...responsesStreamEvents, responsesCompletedEvent]
  const canonical = normalize(exchange, makeChunks(exchange.id, events))

  it("produces a value matching the CanonicalExchange schema", () => {
    expect(decodeCanonical(canonical)).toStrictEqual(canonical)
  })

  it("takes the terminal response.completed payload as authoritative", () => {
    expect(canonical.responseText).toBe("Let me check the weather.")
    expect(canonical.reasoning).toStrictEqual([
      { text: "Need the forecast.", signature: "enc-stream" }
    ])
    expect(canonical.toolCalls).toStrictEqual([
      { id: "call_02", name: "get_weather", input: { location: "Tokyo" } }
    ])
    expect(canonical.stopReason).toBe("completed")
    expect(canonical.usage).toStrictEqual({
      input_tokens: 300,
      output_tokens: 57,
      total_tokens: 357,
      "output_tokens_details.reasoning_tokens": 20
    })
  })

  it("ignores chunk arrival order in favour of sequence", () => {
    const shuffled = [...makeChunks(exchange.id, events)].reverse()
    expect(normalize(exchange, shuffled)).toStrictEqual(canonical)
  })

  it("assembles output from deltas when the stream is truncated", () => {
    const truncated = normalize(exchange, makeChunks(exchange.id, responsesStreamEvents))
    expect(truncated.responseText).toBe("Let me check the weather.")
    expect(truncated.reasoning).toStrictEqual([
      { text: "Need the forecast.", signature: "enc-stream" }
    ])
    expect(truncated.toolCalls).toStrictEqual([
      { id: "call_02", name: "get_weather", input: { location: "Tokyo" } }
    ])
    expect(truncated.stopReason).toBe("in_progress")
    expect(truncated.usage).toStrictEqual({})
  })
})

describe("degenerate exchanges", () => {
  it("normalizes an in-flight chat exchange with no response", () => {
    const canonical = normalize(makeChatExchange({ response_body: null, response_complete: false }))
    expect(canonical.responseText).toBe("")
    expect(canonical.stopReason).toBeNull()
    expect(canonical.usage).toStrictEqual({})
    expect(canonical.systemPrompt).toBeNull()
  })

  it("preserves unknown responses item shapes verbatim", () => {
    const item = { type: "web_search_call", id: "ws_01", status: "completed", role: "assistant" }
    const canonical = normalize(
      makeResponsesExchange({ request_body: encode({ input: [item] }) })
    )
    expect(canonical.messages[0]?.content[0]).toStrictEqual({ type: "unknown", raw: item })
  })

  it("treats a plain string input as a single user message", () => {
    const canonical = normalize(makeResponsesExchange({ request_body: encode({ input: "hello" }) }))
    expect(canonical.messages).toStrictEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] }
    ])
  })

  it("keeps unparseable tool call arguments from a cut-off stream harmless", () => {
    const canonical = normalize(
      makeChatExchange({
        response_body: encode({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                tool_calls: [{ id: "call_03", function: { name: "get_weather", arguments: '{"loca' } }]
              },
              finish_reason: null
            }
          ]
        })
      })
    )
    expect(canonical.toolCalls).toStrictEqual([{ id: "call_03", name: "get_weather", input: {} }])
  })
})
