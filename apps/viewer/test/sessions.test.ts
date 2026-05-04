import type { CanonicalExchange } from "@llmviz/canonical"
import type { Exchange } from "@llmviz/storage"
import { expect, it } from "vitest"
import { groupSessions, nativeSessionId, type SessionCandidate } from "../src/server/sessions.js"

const MINUTE = 60_000

const exchange = (id: string, timestampStart: number, overrides: Partial<Exchange> = {}): Exchange => ({
  id,
  timestamp_start: timestampStart,
  timestamp_end: timestampStart + 10,
  source: "claude-code",
  provider_format: "anthropic",
  http_method: "POST",
  path: "/v1/messages",
  upstream_host: "api.anthropic.com",
  status_code: 200,
  request_headers: {},
  request_body: new TextEncoder().encode("{}"),
  is_streaming: false,
  response_headers: null,
  response_body: null,
  response_complete: true,
  proxy_error: null,
  ...overrides
})

const canonical = (id: string, texts: ReadonlyArray<string>, model = "claude-x"): CanonicalExchange => ({
  id,
  model,
  systemPrompt: null,
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

const candidate = (
  id: string,
  minutes: number,
  texts: ReadonlyArray<string>,
  overrides: Partial<Exchange> = {}
): SessionCandidate => ({
  exchange: exchange(id, minutes * MINUTE, overrides),
  canonical: canonical(id, texts)
})

it("finds no native session signal from headers alone", () => {
  expect(nativeSessionId(candidate("a", 0, ["hi"], { request_headers: { "x-session-id": "s1" } }))).toBeNull()
})

it("extracts the native session id from an Anthropic metadata.user_id body", () => {
  const body = JSON.stringify({
    metadata: { user_id: JSON.stringify({ device_id: "d1", account_uuid: "u1", session_id: "s1" }) }
  })
  expect(
    nativeSessionId(candidate("a", 0, ["hi"], { request_body: new TextEncoder().encode(body) }))
  ).toBe("s1")
})

it("groups exchanges sharing a body-embedded session id even without a message prefix relationship", () => {
  const bodyFor = (sessionId: string): Uint8Array =>
    new TextEncoder().encode(
      JSON.stringify({ metadata: { user_id: JSON.stringify({ session_id: sessionId }) } })
    )

  const sessions = groupSessions([
    candidate("a", 0, ["quota"], { request_body: bodyFor("s1") }),
    candidate("b", 1, ["title"], { request_body: bodyFor("s1") }),
    candidate("c", 2, ["unrelated"], { request_body: bodyFor("s2") })
  ])

  expect(sessions.map((session) => session.exchanges.map((e) => e.id))).toEqual([["a", "b"], ["c"]])
  expect(sessions[0]!.groupedBy).toBe("native")
})

it("chains exchanges whose message history extends a prior exchange", () => {
  const sessions = groupSessions([
    candidate("a", 0, ["one"]),
    candidate("b", 1, ["one", "two"]),
    candidate("c", 2, ["one", "two", "three"])
  ])

  expect(sessions).toHaveLength(1)
  expect(sessions[0]!.exchanges.map((e) => e.id)).toEqual(["a", "b", "c"])
  expect(sessions[0]!.groupedBy).toBe("prefix")
  expect(sessions[0]!.models).toEqual(["claude-x"])
  expect(sessions[0]!.timestampStart).toBe(0)
})

it("splits non-extending exchanges into separate sessions", () => {
  const sessions = groupSessions([
    candidate("a", 0, ["one"]),
    candidate("b", 1, ["different"]),
    candidate("c", 2, ["different", "more"])
  ])

  expect(sessions.map((session) => session.exchanges.map((e) => e.id))).toEqual([["a"], ["b", "c"]])
})

it("splits a chain when the gap exceeds the idle timeout", () => {
  const candidates = [candidate("a", 0, ["one"]), candidate("b", 45, ["one", "two"])]

  expect(groupSessions(candidates, 30).map((s) => s.exchanges.map((e) => e.id))).toEqual([["a"], ["b"]])
  expect(groupSessions(candidates, 60).map((s) => s.exchanges.map((e) => e.id))).toEqual([["a", "b"]])
})

it("never chains across different sources", () => {
  const sessions = groupSessions([
    candidate("a", 0, ["one"]),
    candidate("b", 1, ["one", "two"], { source: "codex", provider_format: "openai" })
  ])

  expect(sessions.map((session) => session.exchanges.map((e) => e.id))).toEqual([["a"], ["b"]])
})

it("does not chain everything onto an exchange with an empty message history", () => {
  const sessions = groupSessions([
    candidate("a", 0, []),
    candidate("b", 1, ["one"]),
    candidate("c", 2, ["unrelated"])
  ])

  expect(sessions).toHaveLength(3)
})

it("orders exchanges within a session chronologically regardless of input order", () => {
  const sessions = groupSessions([candidate("b", 1, ["one", "two"]), candidate("a", 0, ["one"])])

  expect(sessions[0]!.exchanges.map((e) => e.id)).toEqual(["a", "b"])
})
