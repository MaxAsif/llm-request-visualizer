import type { Chunk, Exchange } from "@llmviz/storage"

const encoder = new TextEncoder()

export const encode = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value))

export const makeExchange = (overrides: Partial<Exchange>): Exchange => ({
  id: "ex-1",
  timestamp_start: 1_700_000_000_000,
  timestamp_end: 1_700_000_001_000,
  source: "claude-code",
  provider_format: "anthropic",
  http_method: "POST",
  path: "/v1/messages",
  upstream_host: "api.anthropic.com",
  status_code: 200,
  request_headers: { "content-type": "application/json" },
  request_body: encode({}),
  is_streaming: false,
  response_headers: { "content-type": "application/json" },
  response_body: null,
  response_complete: true,
  proxy_error: null,
  ...overrides
})

export const makeChunks = (exchangeId: string, events: ReadonlyArray<unknown>): Chunk[] =>
  events.map((event, index) => ({
    id: `${exchangeId}-chunk-${index}`,
    exchange_id: exchangeId,
    sequence: index,
    timestamp: 1_700_000_000_000 + index,
    raw_data: encoder.encode(
      `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`
    )
  }))

export const toolUseRequest = {
  model: "claude-opus-5",
  max_tokens: 4096,
  system: [
    { type: "text", text: "You are a coding assistant.", cache_control: { type: "ephemeral" } }
  ],
  tools: [
    {
      name: "get_weather",
      description: "Get current weather for a location",
      input_schema: {
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"]
      }
    }
  ],
  messages: [
    { role: "user", content: "What's the weather in Paris?" },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_01", name: "get_weather", input: { location: "Paris" } }]
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_01",
          content: [{ type: "text", text: "18C and raining" }]
        }
      ]
    }
  ]
}

export const toolUseResponse = {
  id: "msg_01",
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content: [
    { type: "thinking", thinking: "The tool says 18C.", signature: "sig-abc" },
    { type: "text", text: "It is 18C and raining in Paris." }
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: {
    input_tokens: 1024,
    output_tokens: 42,
    cache_creation_input_tokens: 512,
    cache_read_input_tokens: 2048
  }
}

/** message_start → thinking block → text block → tool_use block → message_delta → message_stop. */
export const streamingEvents = [
  {
    type: "message_start",
    message: {
      id: "msg_02",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 300, output_tokens: 1, cache_read_input_tokens: 4096 }
    }
  },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Need the " } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "forecast." } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-stream" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Let me check" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: " the weather." } },
  { type: "content_block_stop", index: 1 },
  {
    type: "content_block_start",
    index: 2,
    content_block: { type: "tool_use", id: "toolu_02", name: "get_weather", input: {} }
  },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"loca' } },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: 'tion": "Tokyo"}' } },
  { type: "content_block_stop", index: 2 },
  {
    type: "message_delta",
    delta: { stop_reason: "tool_use", stop_sequence: null },
    usage: { output_tokens: 57 }
  },
  { type: "message_stop" }
]
