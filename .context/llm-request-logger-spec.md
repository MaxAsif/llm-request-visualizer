# LLM Request/Response Logger & Visualizer — Spec

## Problem Statement

When working with Claude Code and Codex CLI, every LLM request and response — including system prompts, full conversation context, tool definitions, tool calls, tool results, and streamed output — happens invisibly. There's no way to inspect what's actually being sent to or received from the model, compare consecutive turns in an agentic session, or understand token/cache usage across a session. Debugging prompt issues, tool-call behavior, or context growth currently requires guesswork.

## Solution

A local HTTP reverse proxy sits between Claude Code / Codex CLI and the real Anthropic/OpenAI APIs. It transparently forwards all traffic (including streaming responses) while capturing the raw request/response data — including raw SSE chunks — to a pluggable local storage backend (SQLite by default, JSONL as an alternative). A separate browser-based viewer application reads from that same storage to let the user browse, group into sessions, diff, and inspect every request/response, normalizing Anthropic and OpenAI/Codex payload shapes into one canonical, extensible representation.

## User Stories

1. As a developer using Claude Code, I want the proxy to transparently forward all my requests to Anthropic's API, so that using the proxy doesn't change how Claude Code behaves.
2. As a developer using Codex CLI, I want the proxy to transparently forward all my requests to OpenAI's (or an OpenAI-compatible) API, so that using the proxy doesn't change how Codex behaves.
3. As a developer, I want both CLIs to be able to point at the same proxy port, so that I don't need to run separate proxy instances per tool.
4. As a developer, I want the proxy to detect which CLI made a request (via `User-Agent`, falling back to path/shape inference), so that I can filter/browse logs by source tool.
5. As a developer, I want the proxy to detect which provider API format a request uses (Anthropic vs OpenAI), so that requests are parsed and routed correctly.
6. As a developer, I want the proxy to support configurable upstream URLs per provider format, so that I can point Codex at an alternate OpenAI-compatible endpoint if needed.
7. As a developer, I want streaming (SSE) responses to be passed through to the CLI in real time, so that using the proxy doesn't introduce timeouts or stalls.
8. As a developer, I want every raw SSE chunk captured and stored individually, so that I don't lose wire-level fidelity even though the viewer also shows a reconstructed view.
9. As a developer, I want the response to be reconstructed from raw chunks only at read time (not precomputed by the proxy), so that reconstruction logic can be fixed/improved later without needing to re-log anything.
10. As a developer, I want auth headers (e.g. `Authorization`, `x-api-key`) redacted by default in stored logs, so that my log files/database aren't a credential leak risk.
11. As a developer, I want the option to disable redaction, so that I can capture full headers when I specifically need to debug an auth issue.
12. As a developer, I want to choose between SQLite and JSONL as my storage backend via config, so that I can pick fast queryability (SQLite) or simple/appendable/portable storage (JSONL) depending on my needs.
13. As a developer, I want SQLite to be the default storage backend, so that I get good query performance out of the box.
14. As a developer, I want the storage layer to be defined behind a swappable interface, so that new backends can be added later without touching the proxy or viewer.
15. As a developer, I want each HTTP request/response to be logged as a flat, independent exchange record (no proxy-side session tracking), so that the proxy stays simple and stateless.
16. As a developer, I want the viewer to group flat exchanges into sessions on my behalf, so that I can browse a conversation as a coherent whole rather than as disconnected requests.
17. As a developer, I want the viewer to first check for a native session-identifying signal in the traffic (e.g. a header, or `previous_response_id` in the OpenAI Responses API), so that session grouping is as accurate as possible when such a signal exists.
18. As a developer, I want the viewer to fall back to prefix-matching on message history (treating a request whose messages extend a prior request's messages as the same session) when no native signal is available, so that sessions are still grouped sensibly.
19. As a developer, I want the idle-timeout cutoff used by the prefix-matching heuristic to be adjustable in the viewer UI, so that I can tune what counts as "the same session" based on real usage patterns.
20. As a developer, I want the viewer to normalize both Anthropic and OpenAI/Codex payloads into one canonical representation, so that I can browse tool calls, tool results, system prompts, and messages in a consistent shape regardless of provider.
21. As a developer, I want the canonical representation to explicitly surface reasoning/extended-thinking blocks separately from regular message content, so that I can see model reasoning distinctly from output.
22. As a developer, I want the canonical representation to include usage/token data (including cache read/write tokens), so that I can inspect cost and cache-hit behavior per request.
23. As a developer, I want the canonical schema to have an open-ended extension mechanism (e.g. an `extensions` bag plus flexible `usage` map), so that new fields can be added later without breaking existing stored data or requiring migrations.
24. As a developer, I want to see tool definitions, tool calls, and tool results that flow through the LLM API payload, so that I can inspect agentic tool-use behavior.
25. As a developer, I understand that true MCP-server-side invocations (outside LLM API traffic) are out of scope for this tool, so that I have accurate expectations about what is and isn't captured.
26. As a developer, I want a session list view showing grouped sessions sortable/filterable by time, source, and model, so that I can quickly find the session I'm looking for.
27. As a developer, I want a session detail view showing the chronological exchanges within a session, so that I can follow the flow of a conversation.
28. As a developer, I want the session detail view to default to a diff view between consecutive exchanges (highlighting only what's new per turn), so that I don't have to re-read the entire repeated context on every turn.
29. As a developer, I want a toggle to expand any exchange to its full raw/canonical payload, so that I can inspect the complete picture when the diff view isn't enough.
30. As a developer, I want an exchange detail view with a raw/canonical toggle, so that I can see either the normalized representation or the original wire-format payload.
31. As a developer, I want to view the raw chunk stream for a streaming exchange, so that I can inspect exact wire-level SSE behavior when needed.
32. As a developer, I want the proxy to run bound to localhost only with no proxy-side authentication, so that it's safe to use as a personal local dev tool without accidentally exposing it on my network.
33. As a developer, I want the proxy to pass upstream errors straight through without retrying, so that failures aren't masked or double-billed, and CLI-native retry logic isn't interfered with.
34. As a developer, I want proxy-level connection failures (distinct from upstream API errors) to be captured and marked distinctly in the log, so that I can tell proxy problems apart from API problems.
35. As a developer, I want to configure the proxy (port, upstream URLs, storage backend, redaction policy) via a config file with CLI/env overrides, so that I have persistent defaults but can override for one-off debugging sessions.
36. As a developer, I want the proxy and viewer to run as two independent processes communicating only through shared on-disk storage, so that I can restart or iterate on the viewer without interrupting active request logging.
37. As a developer, I want the codebase organized as a pnpm monorepo with shared packages for storage and canonical normalization, so that the proxy and viewer stay in sync on schema/types at compile time.
38. As a developer, I do not need cross-session search in the initial version, so that the MVP can ship focused on core browsing/inspection first.

## Implementation Decisions

### Architecture
- Two independent long-running Node.js/TypeScript processes: `apps/proxy` and `apps/viewer`, communicating only via shared on-disk storage — no direct IPC or shared runtime state.
- pnpm workspace monorepo. Proposed packages:
  - `packages/storage` — storage port (interface) + SQLite and JSONL adapters
  - `packages/canonical` — canonical schema (Effect `Schema`) + normalization functions (raw → canonical) for both provider formats
  - `apps/proxy` — reverse proxy server
  - `apps/viewer` — React + Vite SPA frontend, tRPC API backend
- Built with Effect (`Context`/`Layer` for the storage port/adapters, `Schema` for canonical payload validation/typing, `Stream` for chunked/SSE handling).

### Proxy
- Single shared HTTP port; both Claude Code and Codex CLI point their base-URL configuration at it.
- Detects `source` (`claude-code` | `codex` | `unknown`) via `User-Agent` header first, falling back to path/payload-shape inference.
- Detects `provider_format` (`anthropic` | `openai`) via request path/payload shape.
- Upstream target is a configurable mapping keyed by `provider_format` (defaults: Anthropic → `api.anthropic.com`, OpenAI → `api.openai.com`), overridable in config — not hardcoded, to support alternate OpenAI-compatible endpoints for Codex.
- Streams responses through to the client in real time (SSE passthrough) while simultaneously persisting raw chunks as they arrive.
- No retry logic of any kind — upstream errors and status codes are forwarded verbatim to the client. Proxy-level failures (connection errors, timeouts to upstream) are distinguished from upstream API-level errors via a dedicated `proxy_error` field.
- Redacts known auth headers (`Authorization`, `x-api-key`, and similar) by default before persisting; the real header value is used in-memory only to forward the request. Redaction is configurable (can be disabled) via config/CLI flag.
- Bound to `localhost` only by default; no proxy-side authentication.
- Configuration via a config file (port, upstream URL mapping, storage backend selection, redaction policy), overridable via CLI flags/env vars for one-off runs.

### Storage
- `packages/storage` defines a port (Effect `Context`/`Layer`) with write operations (append exchange, append chunk) and read operations (`getExchange`, `listExchanges`, `getChunks`, etc.), returning a uniform in-memory shape regardless of backend.
- Two initial adapters: SQLite (default) and JSONL. Interface designed for additional backends to be added later without touching proxy or viewer code.
- Data model:
  - `Exchange`: `id`, `timestamp_start`, `timestamp_end`, `source`, `provider_format`, `http_method`, `path`, `upstream_host`, `status_code`, `request_headers` (redacted per policy), `request_body` (raw bytes), `is_streaming`, `response_headers`, `response_body` (populated only for non-streaming exchanges), `response_complete`, `proxy_error`.
  - `Chunk`: `id`, `exchange_id` (FK), `sequence`, `timestamp`, `raw_data` (raw bytes) — one row/record per raw SSE event, only present for streaming exchanges.
- SQLite: chunks as their own table with an `exchange_id` foreign key, ordered by `sequence`. JSONL: chunks in a separate `chunks.jsonl` file (or per-adapter equivalent) referencing `exchange_id` and `sequence`, so chunks can be appended in real time without rewriting the exchange record.
- No content-addressable deduplication or compression at rest for the initial version; raw data is stored as-is even though consecutive exchanges in a session largely duplicate prior context. Revisit only if storage growth becomes a real problem.
- No `cwd`/`pid` tracking — not observable from a plain HTTP reverse proxy without a client-side signal neither CLI currently sends.

### Canonical / Normalization Layer (`packages/canonical`)
- Computed entirely on read, from raw stored `Exchange`/`Chunk` data — never precomputed or persisted by the proxy. Guarantees normalization bugs/improvements never require re-logging.
- Defined via Effect `Schema` as a `CanonicalExchange` struct with explicit typed fields:
  - `model`, `systemPrompt`, `messages` (role + content blocks), `toolDefinitions`, `toolCalls`, `toolResults`, `reasoning` (extended-thinking / reasoning-token blocks, kept distinct from `messages`), `responseText`, `stopReason`
  - `usage`: open-ended `Record<string, number>` rather than fixed named fields, to accommodate cache read/write tokens and future usage metrics without schema changes
  - `extensions`: open `Record<string, unknown>` catch-all for fields not yet modeled
- Two normalization functions (Anthropic Messages API → canonical, OpenAI Chat Completions/Responses API → canonical), operating purely on the in-memory `Exchange`/`Chunk` shape returned by the storage port — normalization code has no awareness of which storage backend served the data.
- Stream reconstruction (assembling raw chunks into a complete logical response) is also computed on read as part of this layer, not stored separately.

### Session Grouping (viewer-side)
- Two-tier strategy, evaluated per `source`/`provider_format`:
  1. Native session/chaining signal, if present in real traffic (to be confirmed empirically once the proxy is capturing live data — candidates include a dedicated header or the OpenAI Responses API's `previous_response_id` field).
  2. Fallback: prefix-matching — an exchange whose message history is a strict prefix-extension of a prior exchange's message history is chained into the same session as that prior exchange.
- Idle-timeout cutoff for the prefix-matching fallback is user-adjustable in the viewer UI (suggested default: ~30 minutes), not a fixed constant.
- All session-grouping logic lives in the viewer/read layer, not the proxy — the proxy never tracks or tags sessions.

### Viewer
- React + Vite SPA, backed by a tRPC API reading through `packages/storage` and `packages/canonical`.
- MVP screens:
  1. **Session list** — grouped sessions, sortable by time, filterable by source and model.
  2. **Session detail** — chronological exchanges within a session; defaults to a diff view highlighting only what changed between consecutive exchanges (collapsed unchanged prefix), with a toggle to expand to the full raw payload per exchange.
  3. **Exchange detail** — canonical/raw toggle for the full payload, plus a dedicated raw chunk stream viewer for streaming exchanges.

## Testing Decisions

- No existing codebase/test conventions to follow — this is a new project, so testing conventions will be established as part of implementation, not inherited.
- Tests should exercise external behavior, not internals:
  - **Storage port**: behavioral contract tests run against both the SQLite and JSONL adapters (write an exchange + chunks, read them back, verify shape equivalence) — ensures both adapters honor the same interface contract, not implementation details of either.
  - **Canonical normalization**: given a raw Anthropic-format or OpenAI-format request/response fixture, assert the resulting `CanonicalExchange` matches expected output — covers system prompt extraction, tool call/result extraction, reasoning block separation, and usage field mapping.
  - **Proxy**: integration-style tests that send a request through the proxy to a mock upstream, and assert (a) the response is forwarded correctly to the client including streaming passthrough, and (b) the correct `Exchange`/`Chunk` records land in storage, including redaction behavior.
  - **Session grouping**: unit tests over sequences of synthetic exchanges verifying prefix-matching groups/splits sessions correctly around the idle timeout boundary.
- Since normalization and session-grouping are pure functions over data (raw bytes → canonical; exchange list → sessions), these should be fast, isolated unit tests with fixture data rather than requiring a live proxy or real API traffic.

## Out of Scope

- Capturing actual MCP server subprocess communication (stdio between the CLI and MCP servers) — only LLM API traffic containing tool definitions/`tool_use`/`tool_result` blocks is captured.
- Cross-session or cross-exchange search (e.g. full-text search over message content, "find all calls to tool X") — deferred to a later phase.
- Automatic retry logic in the proxy.
- Proxy-side authentication / non-localhost network exposure.
- Content-addressable deduplication or compression of stored raw data.
- Precomputed/stored canonical representations or precomputed stream reconstructions — both are always computed fresh on read.
- `cwd`/process metadata tagging (not observable via HTTP proxying alone).
- Multi-user / remote / hosted deployment — this is a local single-user dev tool.

## Further Notes

- The specific header or field used for native session detection (Q17/Q18 in design discussion) is not yet confirmed — it needs to be determined empirically by inspecting real Claude Code and Codex CLI traffic once the proxy is operational. The OpenAI Responses API's `previous_response_id` field is a strong candidate on the Codex side; no candidate is yet known on the Claude Code side.
- Redaction defaults should be reviewed once real traffic is observed, in case other sensitive fields beyond the obvious auth headers turn up in practice (e.g. embedded secrets in tool results/file contents pulled into context) — currently out of scope to design for speculatively per the "don't validate for scenarios that can't happen yet" principle, but worth revisiting after first real usage.
- This spec was produced via a structured design interview (see conversation history) rather than an existing codebase, since the project directory was empty at the start of this work.
