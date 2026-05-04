import type { CanonicalExchange } from "@llmviz/canonical"
import type { Exchange } from "@llmviz/storage"

export interface SessionCandidate {
  readonly exchange: Exchange
  readonly canonical: CanonicalExchange
}

export interface Session {
  readonly id: string
  readonly exchanges: ReadonlyArray<Exchange>
  readonly timestampStart: number
  readonly timestampEnd: number
  readonly source: Exchange["source"]
  readonly providerFormat: Exchange["provider_format"]
  readonly models: ReadonlyArray<string>
  readonly groupedBy: "native" | "prefix"
}

export const DEFAULT_IDLE_TIMEOUT_MINUTES = 30

/**
 * Request headers that carry a provider- or CLI-native session identifier.
 *
 * Deliberately empty: no such header has been empirically confirmed for Claude Code or Codex
 * yet (see the spec's "Further Notes"). This is the extension point — once real traffic
 * confirms a header, add its lowercased name here and native grouping starts working with no
 * other change. The OpenAI Responses API's `previous_response_id` is a chaining signal rather
 * than a session id, so it does not belong in this list.
 */
const NATIVE_SESSION_HEADERS: ReadonlyArray<string> = []

const decoder = new TextDecoder()

/**
 * Claude Code sends its session id inside the request body, not a header: the Anthropic
 * `metadata.user_id` field is a JSON-encoded string of the form
 * `{"device_id":...,"account_uuid":...,"session_id":...}`. Confirmed empirically against real
 * proxy traffic — this is the header extension point mentioned above, applied to the body.
 */
const bodySessionId = (body: Uint8Array): string | null => {
  try {
    const parsed: unknown = JSON.parse(decoder.decode(body))
    if (typeof parsed !== "object" || parsed === null) return null
    const userId = (parsed as { metadata?: unknown }).metadata
    const rawUserId =
      typeof userId === "object" && userId !== null ? (userId as { user_id?: unknown }).user_id : undefined
    if (typeof rawUserId !== "string") return null
    const decodedUserId: unknown = JSON.parse(rawUserId)
    if (typeof decodedUserId !== "object" || decodedUserId === null) return null
    const sessionId = (decodedUserId as { session_id?: unknown }).session_id
    return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null
  } catch {
    return null
  }
}

export const nativeSessionId = ({ exchange }: SessionCandidate): string | null => {
  for (const header of NATIVE_SESSION_HEADERS) {
    const value = exchange.request_headers[header]
    if (value !== undefined && value.length > 0) return value
  }
  return bodySessionId(exchange.request_body)
}

const fingerprint = (canonical: CanonicalExchange): ReadonlyArray<string> =>
  canonical.messages.map((message) => JSON.stringify(message))

const isPrefixOf = (prior: ReadonlyArray<string>, next: ReadonlyArray<string>): boolean => {
  if (prior.length === 0 || prior.length > next.length) return false
  return prior.every((entry, index) => entry === next[index])
}

interface Group {
  readonly id: string
  readonly groupedBy: "native" | "prefix"
  readonly members: Array<{ readonly candidate: SessionCandidate; readonly messages: ReadonlyArray<string> }>
}

const toSession = (group: Group): Session => {
  const exchanges = group.members.map((member) => member.candidate.exchange)
  const models = [
    ...new Set(
      group.members
        .map((member) => member.candidate.canonical.model)
        .filter((model): model is string => model !== null)
    )
  ]
  const first = exchanges[0]!
  const last = exchanges[exchanges.length - 1]!
  return {
    id: group.id,
    exchanges,
    timestampStart: first.timestamp_start,
    timestampEnd: last.timestamp_end ?? last.timestamp_start,
    source: first.source,
    providerFormat: first.provider_format,
    models,
    groupedBy: group.groupedBy
  }
}

/**
 * Two-tier grouping: a native session signal wins outright, and everything without one falls
 * back to prefix-matching — an exchange joins the session containing the most recent prior
 * exchange whose canonical message history is a prefix of its own, provided the gap between
 * the two is within the idle timeout.
 */
export const groupSessions = (
  candidates: ReadonlyArray<SessionCandidate>,
  idleTimeoutMinutes: number = DEFAULT_IDLE_TIMEOUT_MINUTES
): ReadonlyArray<Session> => {
  const idleTimeoutMs = idleTimeoutMinutes * 60_000
  const ordered = [...candidates].sort(
    (a, b) => a.exchange.timestamp_start - b.exchange.timestamp_start
  )

  const groups: Group[] = []
  const nativeGroups = new Map<string, Group>()

  for (const candidate of ordered) {
    const messages = fingerprint(candidate.canonical)
    const native = nativeSessionId(candidate)

    if (native !== null) {
      const existing = nativeGroups.get(native)
      if (existing === undefined) {
        const group: Group = { id: native, groupedBy: "native", members: [{ candidate, messages }] }
        nativeGroups.set(native, group)
        groups.push(group)
      } else {
        existing.members.push({ candidate, messages })
      }
      continue
    }

    let best: { readonly group: Group; readonly matched: number } | null = null
    for (const group of groups) {
      if (group.groupedBy === "native") continue
      const head = group.members[0]!.candidate.exchange
      if (
        head.source !== candidate.exchange.source ||
        head.provider_format !== candidate.exchange.provider_format
      ) {
        continue
      }
      for (let index = group.members.length - 1; index >= 0; index -= 1) {
        const member = group.members[index]!
        const gap = candidate.exchange.timestamp_start - member.candidate.exchange.timestamp_start
        if (gap > idleTimeoutMs) break
        if (!isPrefixOf(member.messages, messages)) continue
        if (best === null || member.messages.length > best.matched) {
          best = { group, matched: member.messages.length }
        }
        break
      }
    }

    if (best === null) {
      groups.push({
        id: candidate.exchange.id,
        groupedBy: "prefix",
        members: [{ candidate, messages }]
      })
    } else {
      best.group.members.push({ candidate, messages })
    }
  }

  return groups.map(toSession)
}
