export const chatRequest = {
  model: "gpt-5-codex",
  temperature: 0.2,
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather for a location",
        parameters: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"]
        }
      }
    }
  ],
  messages: [
    { role: "system", content: "You are a coding assistant." },
    { role: "user", content: "What's the weather in Paris?" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_01",
          type: "function",
          function: { name: "get_weather", arguments: '{"location":"Paris"}' }
        }
      ]
    },
    { role: "tool", tool_call_id: "call_01", content: "18C and raining" }
  ]
}

export const chatResponse = {
  id: "chatcmpl_01",
  object: "chat.completion",
  created: 1_700_000_000,
  model: "gpt-5-codex",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "It is 18C and raining in Paris.", refusal: null },
      finish_reason: "stop"
    }
  ],
  usage: {
    prompt_tokens: 1024,
    completion_tokens: 42,
    total_tokens: 1066,
    prompt_tokens_details: { cached_tokens: 512 },
    completion_tokens_details: { reasoning_tokens: 128 }
  },
  system_fingerprint: "fp_01"
}

/** role delta → text deltas → tool_call deltas → finish_reason → usage-only chunk → [DONE]. */
export const chatStreamPayloads = [
  {
    id: "chatcmpl_02",
    object: "chat.completion.chunk",
    model: "gpt-5-codex",
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
    usage: null
  },
  {
    id: "chatcmpl_02",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content: "Let me check" }, finish_reason: null }]
  },
  {
    id: "chatcmpl_02",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content: " the weather." }, finish_reason: null }]
  },
  {
    id: "chatcmpl_02",
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: "call_02", type: "function", function: { name: "get_weather", arguments: "" } }
          ]
        },
        finish_reason: null
      }
    ]
  },
  {
    id: "chatcmpl_02",
    object: "chat.completion.chunk",
    choices: [
      { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"loca' } }] }, finish_reason: null }
    ]
  },
  {
    id: "chatcmpl_02",
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: 'tion": "Tokyo"}' } }] },
        finish_reason: null
      }
    ]
  },
  {
    id: "chatcmpl_02",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
  },
  {
    id: "chatcmpl_02",
    object: "chat.completion.chunk",
    choices: [],
    usage: { prompt_tokens: 300, completion_tokens: 57, total_tokens: 357 }
  }
]

export const chatStreamChunks = [
  ...chatStreamPayloads.map((payload) => JSON.stringify(payload)),
  "[DONE]"
]

export const responsesRequest = {
  model: "gpt-5-codex",
  instructions: "You are a coding assistant.",
  store: false,
  previous_response_id: "resp_00",
  tools: [
    {
      type: "function",
      name: "get_weather",
      description: "Get current weather for a location",
      parameters: {
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"]
      }
    }
  ],
  input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "What's the weather in Paris?" }] },
    {
      type: "reasoning",
      id: "rs_01",
      summary: [{ type: "summary_text", text: "I should call the weather tool." }],
      encrypted_content: "enc-abc"
    },
    {
      type: "function_call",
      id: "fc_01",
      call_id: "call_01",
      name: "get_weather",
      arguments: '{"location":"Paris"}',
      status: "completed"
    },
    { type: "function_call_output", call_id: "call_01", output: "18C and raining" }
  ]
}

export const responsesResponse = {
  id: "resp_01",
  object: "response",
  created_at: 1_700_000_000,
  status: "completed",
  model: "gpt-5-codex",
  output: [
    {
      type: "reasoning",
      id: "rs_02",
      summary: [{ type: "summary_text", text: "The tool says 18C." }],
      encrypted_content: "enc-def"
    },
    {
      type: "message",
      id: "msg_01",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: "It is 18C and raining in Paris.", annotations: [] }]
    }
  ],
  usage: {
    input_tokens: 1024,
    output_tokens: 42,
    total_tokens: 1066,
    input_tokens_details: { cached_tokens: 512 },
    output_tokens_details: { reasoning_tokens: 128 }
  },
  previous_response_id: "resp_00"
}

/** created → reasoning item + summary deltas → message item + text deltas → function_call + argument deltas → completed. */
export const responsesStreamEvents = [
  {
    type: "response.created",
    response: { id: "resp_02", object: "response", status: "in_progress", model: "gpt-5-codex", output: [] }
  },
  {
    type: "response.output_item.added",
    output_index: 0,
    item: { type: "reasoning", id: "rs_03", summary: [], encrypted_content: "enc-stream" }
  },
  {
    type: "response.reasoning_summary_text.delta",
    output_index: 0,
    summary_index: 0,
    delta: "Need the "
  },
  {
    type: "response.reasoning_summary_text.delta",
    output_index: 0,
    summary_index: 0,
    delta: "forecast."
  },
  {
    type: "response.output_item.added",
    output_index: 1,
    item: { type: "message", id: "msg_02", status: "in_progress", role: "assistant", content: [] }
  },
  { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "Let me check" },
  { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: " the weather." },
  {
    type: "response.output_item.added",
    output_index: 2,
    item: {
      type: "function_call",
      id: "fc_02",
      call_id: "call_02",
      name: "get_weather",
      arguments: "",
      status: "in_progress"
    }
  },
  { type: "response.function_call_arguments.delta", output_index: 2, delta: '{"loca' },
  { type: "response.function_call_arguments.delta", output_index: 2, delta: 'tion": "Tokyo"}' }
]

/** The terminal event that carries the authoritative final response object. */
export const responsesCompletedEvent = {
  type: "response.completed",
  response: {
    id: "resp_02",
    object: "response",
    status: "completed",
    model: "gpt-5-codex",
    output: [
      {
        type: "reasoning",
        id: "rs_03",
        summary: [{ type: "summary_text", text: "Need the forecast." }],
        encrypted_content: "enc-stream"
      },
      {
        type: "message",
        id: "msg_02",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: "Let me check the weather.", annotations: [] }]
      },
      {
        type: "function_call",
        id: "fc_02",
        call_id: "call_02",
        name: "get_weather",
        arguments: '{"location": "Tokyo"}',
        status: "completed"
      }
    ],
    usage: {
      input_tokens: 300,
      output_tokens: 57,
      total_tokens: 357,
      output_tokens_details: { reasoning_tokens: 20 }
    }
  }
}
