import type { Chunk } from "@llmviz/storage"
import { asNumberOrNull, asString, decodeText, isRecord, type Json } from "./json.js"

/**
 * Both providers repeat the event name inside the `data` payload, so the `event:` line is
 * redundant and only the JSON payloads are collected here.
 */
export const parseEvents = (text: string): ReadonlyArray<Json> => {
  const events: Json[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trimEnd()
    if (!trimmed.startsWith("data:")) continue
    const payload = trimmed.slice("data:".length).trim()
    if (payload.length === 0) continue
    try {
      const parsed: unknown = JSON.parse(payload)
      if (isRecord(parsed)) events.push(parsed)
    } catch {
      // A truncated stream can leave a partial final event; earlier events stay usable.
    }
  }
  return events
}

export const chunkText = (chunks: ReadonlyArray<Chunk>): string =>
  [...chunks]
    .sort((a, b) => a.sequence - b.sequence)
    .map((chunk) => decodeText(chunk.raw_data))
    .join("")

/**
 * Replays raw Anthropic SSE chunks into the message shape a non-streaming response
 * would have returned.
 */
export const reconstructStream = (chunks: ReadonlyArray<Chunk>): Json => {
  const text = chunkText(chunks)

  let message: Json = {}
  const blocks = new Map<number, Json>()
  const partialJson = new Map<number, string>()

  for (const event of parseEvents(text)) {
    switch (event["type"]) {
      case "message_start": {
        const start = event["message"]
        if (isRecord(start)) message = { ...start }
        break
      }

      case "content_block_start": {
        const index = asNumberOrNull(event["index"])
        const block = event["content_block"]
        if (index === null || !isRecord(block)) break
        blocks.set(index, { ...block })
        partialJson.set(index, "")
        break
      }

      case "content_block_delta": {
        const index = asNumberOrNull(event["index"])
        const delta = event["delta"]
        if (index === null || !isRecord(delta)) break
        const block = blocks.get(index)
        if (block === undefined) break
        switch (delta["type"]) {
          case "text_delta":
            block["text"] = asString(block["text"]) + asString(delta["text"])
            break
          case "thinking_delta":
            block["thinking"] = asString(block["thinking"]) + asString(delta["thinking"])
            break
          case "signature_delta":
            block["signature"] = asString(block["signature"]) + asString(delta["signature"])
            break
          case "input_json_delta":
            partialJson.set(index, (partialJson.get(index) ?? "") + asString(delta["partial_json"]))
            break
        }
        break
      }

      case "content_block_stop": {
        const index = asNumberOrNull(event["index"])
        if (index === null) break
        const block = blocks.get(index)
        const accumulated = partialJson.get(index)
        if (block === undefined || accumulated === undefined) break
        if (block["type"] === "tool_use") {
          try {
            block["input"] = accumulated.length === 0 ? {} : JSON.parse(accumulated)
          } catch {
            block["input"] = {}
          }
        }
        break
      }

      case "message_delta": {
        const delta = event["delta"]
        if (isRecord(delta)) message = { ...message, ...delta }
        const usage = event["usage"]
        if (isRecord(usage)) {
          const existing = message["usage"]
          message["usage"] = { ...(isRecord(existing) ? existing : {}), ...usage }
        }
        break
      }
    }
  }

  message["content"] = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block)
  return message
}
