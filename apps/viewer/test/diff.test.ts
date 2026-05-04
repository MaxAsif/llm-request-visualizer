import type { CanonicalExchange } from "@llmviz/canonical"
import { expect, it } from "vitest"
import { diffExchange } from "../src/server/diff.js"

const canonical = (
  texts: ReadonlyArray<string>,
  systemPrompt: string | null = null
): CanonicalExchange => ({
  id: texts.join("-"),
  model: "claude-x",
  systemPrompt,
  messages: texts.map((text) => ({ role: "user", content: [{ type: "text" as const, text }] })),
  toolDefinitions: [],
  toolCalls: [],
  toolResults: [],
  reasoning: [],
  responseText: "",
  stopReason: null,
  usage: {},
  extensions: {}
})

it("collapses the shared prefix and reports only the new tail", () => {
  const diff = diffExchange(canonical(["one", "two"]), canonical(["one", "two", "three"]))

  expect(diff.unchangedMessages).toBe(2)
  expect(diff.newMessages.map((message) => message.content[0])).toEqual([
    { type: "text", text: "three" }
  ])
  expect(diff.diverged).toBe(false)
  expect(diff.systemPromptChanged).toBe(false)
})

it("flags divergence when the prior history was rewritten", () => {
  const diff = diffExchange(canonical(["one", "two"]), canonical(["one", "edited", "three"]))

  expect(diff.unchangedMessages).toBe(1)
  expect(diff.newMessages.length).toBe(2)
  expect(diff.diverged).toBe(true)
})

it("reports a changed system prompt and an unchanged conversation", () => {
  const diff = diffExchange(canonical(["one"], "be brief"), canonical(["one"], "be verbose"))

  expect(diff.unchangedMessages).toBe(1)
  expect(diff.newMessages).toEqual([])
  expect(diff.diverged).toBe(false)
  expect(diff.systemPromptChanged).toBe(true)
})
