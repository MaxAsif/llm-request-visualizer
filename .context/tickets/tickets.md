# Tickets: LLM Request/Response Logger & Visualizer

Vertical-slice breakdown of `.context/llm-request-logger-spec.md` — a local reverse proxy that logs Claude Code / Codex CLI LLM traffic, plus a browser-based viewer to inspect it.

Work the **frontier**: any ticket whose blockers are all done.

## Monorepo scaffold + storage port + SQLite adapter

**What to build:** The foundational pnpm workspace and the storage abstraction everything else depends on. Sets up `packages/storage` (the `Exchange`/`Chunk` types and the storage port as an Effect `Context`/`Layer`), `packages/canonical`, `apps/proxy`, and `apps/viewer` as empty scaffolds, and a working SQLite adapter implementing the storage port.

**Blocked by:** None — can start immediately

- [ ] pnpm workspace builds with all four packages present
- [ ] `Exchange` and `Chunk` types defined per spec (fields: id, timestamps, source, provider_format, http_method, path, upstream_host, status_code, headers, bodies, is_streaming, response_complete, proxy_error; chunks: id, exchange_id, sequence, timestamp, raw_data)
- [ ] Storage port interface defined (write exchange, append chunk, get exchange, list exchanges, get chunks)
- [ ] SQLite adapter implements the port; chunks stored in their own table with `exchange_id` FK ordered by `sequence`
- [ ] Contract test suite: write an exchange + chunks, read back, verify shape equivalence

## JSONL storage adapter

**What to build:** A second storage backend proving the storage port is truly backend-agnostic, selectable as an alternative to SQLite.

**Blocked by:** Monorepo scaffold + storage port + SQLite adapter

- [ ] JSONL adapter implements the same storage port
- [ ] Chunks stored in a separate `chunks.jsonl` (or equivalent), referencing `exchange_id` + `sequence`, appendable without rewriting the exchange record
- [ ] Same contract test suite from the SQLite ticket passes against the JSONL adapter unmodified

## Proxy MVP: non-streaming forward + logging

**What to build:** A running reverse proxy that both CLIs can point at. Accepts a non-streaming request, detects which CLI/provider sent it, forwards it to the correct upstream, returns the real response to the client, and logs the exchange to storage. Demoable with `curl` through the proxy against a real or mock upstream.

**Blocked by:** Monorepo scaffold + storage port + SQLite adapter

- [ ] Proxy binds to `localhost` only, no proxy-side auth
- [ ] Detects `source` via `User-Agent` header, falling back to path/shape inference
- [ ] Detects `provider_format` via path/payload shape
- [ ] Upstream target resolved via a configurable mapping keyed by `provider_format` (defaults: Anthropic/OpenAI real endpoints)
- [ ] Non-streaming request/response round-trips correctly through the proxy to a real or mocked upstream
- [ ] Exchange record written to storage for each request, including status code and both bodies
- [ ] Upstream errors forwarded verbatim (no retries); proxy-level connection failures recorded distinctly via `proxy_error`

## Streaming passthrough + raw chunk capture

**What to build:** SSE streaming support — the proxy passes streamed responses to the client in real time while durably capturing every raw chunk.

**Blocked by:** Proxy MVP: non-streaming forward + logging

- [ ] Streaming request to the proxy streams chunks to the client with no added stalling/buffering delay
- [ ] Each raw SSE chunk persisted as its own `Chunk` record in sequence order, in real time as it arrives
- [ ] `Exchange.response_complete` reflects whether the stream finished cleanly vs. errored/disconnected mid-flight

## Redaction + config file

**What to build:** Safe-by-default handling of sensitive request data, and a config file (with CLI/env overrides) so proxy behavior doesn't require code changes to adjust.

**Blocked by:** Proxy MVP: non-streaming forward + logging

- [ ] Known auth headers (`Authorization`, `x-api-key`, etc.) redacted in stored `request_headers` by default
- [ ] Redaction can be disabled via config/flag; real header value is always used in-memory to forward the request regardless of redaction setting
- [ ] Config file controls port, upstream URL mapping, storage backend selection, and redaction policy
- [ ] CLI flags/env vars override config file values for a single run

## Canonical schema + Anthropic normalization

**What to build:** The canonical `CanonicalExchange` Effect Schema, and a normalization function turning a raw Anthropic-format `Exchange`/`Chunk` set into that canonical shape.

**Blocked by:** Monorepo scaffold + storage port + SQLite adapter

- [ ] `CanonicalExchange` Schema defined with typed fields (model, systemPrompt, messages, toolDefinitions, toolCalls, toolResults, reasoning, responseText, stopReason), open `usage: Record<string, number>`, and open `extensions: Record<string, unknown>`
- [ ] Anthropic Messages API raw payload → `CanonicalExchange` normalization function
- [ ] Stream reconstruction (raw chunks → complete logical response) implemented as part of this layer, computed on read
- [ ] Unit tests against fixture Anthropic request/response payloads (including tool use, extended thinking, cache usage fields) assert correct canonical output

## OpenAI/Codex normalization

**What to build:** The equivalent normalization function for OpenAI/Codex payloads, sharing the same canonical schema so both providers render identically in the viewer.

**Blocked by:** Canonical schema + Anthropic normalization

- [ ] OpenAI Chat Completions/Responses API raw payload → `CanonicalExchange` normalization function
- [ ] Unit tests against fixture OpenAI/Codex request/response payloads (including tool calls, reasoning tokens, usage) assert correct canonical output

## Viewer scaffold + flat exchange list

**What to build:** The first working screen of the viewer app — a React+Vite+tRPC application that lists raw exchanges read live from storage, unsorted into sessions.

**Blocked by:** Monorepo scaffold + storage port + SQLite adapter, Proxy MVP: non-streaming forward + logging

- [ ] tRPC API backend reads exchanges through the storage port
- [ ] React+Vite frontend renders a flat, time-ordered list of exchanges with basic metadata (time, source, provider, status)
- [ ] Running the proxy and making real requests causes new exchanges to appear in the viewer

## Session grouping (prefix-matching + adjustable idle timeout)

**What to build:** Turns the flat exchange list into a session-list view, grouping exchanges via the two-tier strategy (native signal first, prefix-matching fallback) with a user-adjustable idle timeout.

**Blocked by:** Viewer scaffold + flat exchange list

- [ ] Grouping logic checks for a native session-identifying signal per `source`/`provider_format` where one is known to exist
- [ ] Falls back to prefix-matching: an exchange whose message history extends a prior exchange's is grouped into the same session
- [ ] Idle-timeout cutoff for the fallback is adjustable via a UI control, with a sensible default (~30 min)
- [ ] Session-list view shows grouped sessions, sortable by time, filterable by source and model

## Session detail view with default diff / raw toggle

**What to build:** Clicking into a session shows its exchanges chronologically, defaulting to a diff view that highlights only what's new per turn, with a toggle to see the full raw payload for any exchange.

**Blocked by:** Session grouping (prefix-matching + adjustable idle timeout), OpenAI/Codex normalization, Streaming passthrough + raw chunk capture

- [ ] Session detail view lists exchanges within a session in chronological order
- [ ] Default view diffs each exchange against the previous one in the session, collapsing the unchanged prefix and highlighting additions (new message, tool call, or tool result)
- [ ] Toggle available per exchange to expand to the full raw (non-diffed) payload

## Exchange detail view: canonical/raw toggle + raw chunk stream viewer

**What to build:** The full single-exchange inspection screen — canonical vs. raw payload toggle, plus a dedicated raw SSE chunk stream viewer for streaming exchanges.

**Blocked by:** Viewer scaffold + flat exchange list, OpenAI/Codex normalization, Streaming passthrough + raw chunk capture

- [ ] Exchange detail screen shows the canonical representation (system prompt, messages, tool calls/results, usage) by default
- [ ] Toggle switches to the full raw request/response payload
- [ ] For streaming exchanges, a dedicated view lists raw chunks in sequence with timestamps
