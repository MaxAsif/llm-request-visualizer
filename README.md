# LLM Visualizer

A local logging proxy and browser-based viewer for Claude Code and Codex CLI traffic. Point either CLI's API base URL at the proxy, and every request/response exchange — headers, JSON body, streaming SSE chunks — gets recorded and rendered as structured, diffable exchanges grouped into sessions.

More on what it does and why: [project writeup](https://maxasif.nexuslab.in/projects/llm-visualizer), [architecture and data model](https://maxasif.nexuslab.in/blog/llm-visualizer-project-overview), [a debugging story about session grouping](https://maxasif.nexuslab.in/blog/one-claude-code-session-four-rows).

## How it's put together

```
packages/
├── canonical/   # Provider-agnostic request/response schema + normalizers
└── storage/     # Storage port + SQLite implementation (exchanges, chunks)
apps/
├── proxy/       # Logging reverse proxy in front of the model API
└── viewer/      # tRPC API + React/Vite UI
```

The proxy forwards every request upstream unmodified and tees a copy to storage on the way through. It doesn't require any change to how Claude Code or Codex CLI behaves — it just needs to sit in the request path.

## Quick start (Docker)

```bash
docker compose up --build
```

This builds and runs both services: the proxy on `http://localhost:8317` and the viewer UI on `http://localhost:5317`. Both containers share a named volume (`llmviz-data`) so the SQLite file the proxy writes is the same one the viewer reads — nothing to wire up manually. Point Claude Code or Codex at `http://localhost:8317` as described below, then open `http://localhost:5317`.

Skip to [Pointing Claude Code at it](#pointing-claude-code-at-it) once the stack is up, or read on for running everything directly with `pnpm` instead.

## Setup

```bash
pnpm install
pnpm build
```

Requires Node.js and pnpm (workspace uses `pnpm@11`). `better-sqlite3` (used by the default storage backend) has a native build step — `pnpm-workspace.yaml` already allows it via `allowBuilds`.

## Running the proxy

```bash
pnpm --filter @llmviz/proxy start
```

By default it listens on `127.0.0.1:8317` and forwards to `api.anthropic.com` / `api.openai.com` depending on the detected request format, logging everything to a local `llmviz.db` SQLite file in the current directory.

Configuration is resolved with this precedence (lowest to highest): built-in defaults → `llmviz.config.json` (or `--config <path>`) → environment variables → CLI flags.

| Env var | CLI flag | Default | Purpose |
| --- | --- | --- | --- |
| `LLMVIZ_HOST` | `--host` | `127.0.0.1` | Address the proxy listens on |
| `LLMVIZ_PORT` | `--port` | `8317` | Port the proxy listens on |
| `LLMVIZ_UPSTREAM_ANTHROPIC` | `--upstream-anthropic` | `https://api.anthropic.com` | Where Anthropic-format requests are forwarded |
| `LLMVIZ_UPSTREAM_OPENAI` | `--upstream-openai` | `https://api.openai.com` | Where OpenAI-format requests are forwarded (e.g. an alternate Codex-compatible endpoint) |
| `LLMVIZ_STORAGE` | `--storage` | `sqlite` | `sqlite` or `jsonl` |
| `LLMVIZ_DB` | `--db` | `llmviz.db` | SQLite database path (when `storageBackend` is `sqlite`) |
| `LLMVIZ_JSONL_DIR` | `--jsonl-dir` | `llmviz-logs` | Output directory (when `storageBackend` is `jsonl`) |
| `LLMVIZ_REDACT` | `--redact` / `--no-redact` | `true` | Redact sensitive headers (`authorization`, `x-api-key`, `cookie`, etc.) before storing |
| `LLMVIZ_REDACTED_HEADERS` | `--redacted-headers` | see `DEFAULT_REDACTED_HEADERS` in `apps/proxy/src/config.ts` | Comma-separated header names to redact |

Running via Docker instead? Set any of these under `services.proxy.environment` in `docker-compose.yml` — same variable names.

## Pointing Claude Code at it

Claude Code reads its API base URL from `ANTHROPIC_BASE_URL`:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8317
claude
```

Requests still carry your real credentials — the proxy only reads and forwards them (redacting `authorization` before writing to storage), it never terminates auth.

## Pointing Codex CLI at it

Codex CLI resolves its OpenAI-compatible base URL either via `OPENAI_BASE_URL` or the `base_url` field of the provider entry in `~/.codex/config.toml`, depending on your Codex version. Point it at the same proxy port:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:8317
codex
```

Since the proxy forwards based on the detected request shape (path and body), Claude Code and Codex traffic can both go through the same running proxy instance at once.

## Running the viewer

The viewer is two processes in dev: a tRPC API server reading from the same storage the proxy wrote to, and a Vite dev server for the React UI that proxies `/trpc` calls to the API. (The Docker image runs the same two processes inside one container, serving the production build via `vite preview` instead — see [Quick start (Docker)](#quick-start-docker).)

```bash
pnpm --filter @llmviz/viewer build

# terminal 1 — API server (reads llmviz.db)
LLMVIZ_DB=llmviz.db pnpm --filter @llmviz/viewer dev:api

# terminal 2 — UI
pnpm --filter @llmviz/viewer dev
```

Open the UI at `http://127.0.0.1:5317`. The API defaults to `127.0.0.1:8318`; override with `LLMVIZ_VIEWER_HOST` / `LLMVIZ_VIEWER_API_PORT`. If you're accessing the Vite dev server from a non-localhost hostname, add it to `LLMVIZ_VIEWER_ALLOWED_HOSTS` (comma-separated) in `apps/viewer/.env`.

The **sessions** tab groups exchanges into conversations (via a native session signal where the CLI provides one, falling back to message-history prefix matching within an idle timeout). The **exchanges** tab lists every logged request/response pair directly. Each exchange can be viewed as a diff against the previous turn, a normalized canonical view (messages, tool calls, tool results, usage), or the raw headers/body/SSE chunks as sent.

## Development

```bash
pnpm build       # tsc -b across the workspace
pnpm typecheck   # build + test + viewer client project references
pnpm test        # vitest run
```
