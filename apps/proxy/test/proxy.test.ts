import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { type Exchange, Sqlite, Storage, type StorageService } from "@llmviz/storage"
import { Context, Effect, Exit, Layer, Scope } from "effect"
import { afterEach, beforeEach, expect, it } from "vitest"
import { defaultConfig, type ProxyConfig } from "../src/config.js"
import { type ProxyHandle, start } from "../src/server.js"

interface UpstreamCall {
  readonly method: string
  readonly url: string
  readonly headers: NodeJS.Dict<string | string[]>
  readonly body: string
}

interface Upstream {
  readonly port: number
  readonly calls: Array<UpstreamCall>
  readonly close: () => Promise<void>
}

const startUpstream = async (
  respond: (req: IncomingMessage, res: ServerResponse) => void
): Promise<Upstream> => {
  const calls: Array<UpstreamCall> = []
  const server: Server = createServer((req, res) => {
    const parts: Array<Buffer> = []
    req.on("data", (part: Buffer) => parts.push(part))
    req.on("end", () => {
      calls.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(parts).toString("utf8")
      })
      respond(req, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  return {
    port: typeof address === "object" && address !== null ? address.port : 0,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

let storage: StorageService
let releaseStorage: () => Promise<void>
let proxy: ProxyHandle | undefined
let upstream: Upstream | undefined

beforeEach(async () => {
  const scope = await Effect.runPromise(Scope.make())
  const context = await Effect.runPromise(
    Effect.orDie(Scope.extend(Layer.build(Sqlite.layer(":memory:")), scope))
  )
  storage = Context.get(context, Storage)
  releaseStorage = () => Effect.runPromise(Scope.close(scope, Exit.void))
})

afterEach(async () => {
  await proxy?.close()
  await upstream?.close()
  proxy = undefined
  upstream = undefined
  await releaseStorage()
})

const configFor = (upstreamPort: number): ProxyConfig => ({
  host: "127.0.0.1",
  port: 0,
  upstreams: {
    anthropic: `http://127.0.0.1:${upstreamPort}`,
    openai: `http://127.0.0.1:${upstreamPort}`
  },
  databasePath: ":memory:"
})

const post = async (port: number, path: string, headers: Record<string, string>, body: unknown) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  })
  return { status: response.status, text: await response.text(), headers: response.headers }
}

const loggedExchanges = (): Promise<ReadonlyArray<Exchange>> =>
  Effect.runPromise(Effect.orDie(storage.listExchanges()))

const text = (bytes: Uint8Array | null) =>
  bytes === null ? null : new TextDecoder().decode(bytes)

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The exchange is finalised after the client's stream ends, so poll for the final write. */
const settledExchange = async (): Promise<Exchange> => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const [exchange] = await loggedExchanges()
    if (exchange !== undefined && exchange.timestamp_end !== null) return exchange
    await sleep(10)
  }
  throw new Error("exchange never settled")
}

interface Arrival {
  readonly at: number
  readonly text: string
}

const postStreaming = async (
  port: number,
  path: string,
  body: unknown
): Promise<{ status: number; arrivals: Array<Arrival>; failed: boolean }> => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const arrivals: Array<Arrival> = []
  const startedAt = Date.now()
  let failed = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      arrivals.push({ at: Date.now() - startedAt, text: decoder.decode(value) })
    }
  } catch {
    failed = true
  }
  return { status: response.status, arrivals, failed }
}

it("round-trips a non-streaming request and logs the exchange", async () => {
  upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ id: "msg_1", content: [{ type: "text", text: "hi" }] }))
  })
  proxy = await start(configFor(upstream.port), storage)

  const response = await post(
    proxy.port,
    "/v1/messages",
    { "user-agent": "claude-cli/1.2.3", "x-api-key": "sk-secret" },
    { model: "claude-sonnet-5", messages: [{ role: "user", content: "hey" }] }
  )

  expect(response.status).toBe(200)
  expect(JSON.parse(response.text)).toEqual({
    id: "msg_1",
    content: [{ type: "text", text: "hi" }]
  })

  expect(upstream.calls).toHaveLength(1)
  expect(upstream.calls[0]!.url).toBe("/v1/messages")
  expect(upstream.calls[0]!.headers["x-api-key"]).toBe("sk-secret")

  const [exchange] = await loggedExchanges()
  expect(exchange).toBeDefined()
  expect(exchange!.source).toBe("claude-code")
  expect(exchange!.provider_format).toBe("anthropic")
  expect(exchange!.http_method).toBe("POST")
  expect(exchange!.path).toBe("/v1/messages")
  expect(exchange!.status_code).toBe(200)
  expect(exchange!.is_streaming).toBe(false)
  expect(exchange!.response_complete).toBe(true)
  expect(exchange!.proxy_error).toBeNull()
  expect(JSON.parse(text(exchange!.request_body)!).model).toBe("claude-sonnet-5")
  expect(JSON.parse(text(exchange!.response_body)!).id).toBe("msg_1")
  expect(exchange!.timestamp_end).not.toBeNull()
})

it("routes by provider format and detects codex from the user agent", async () => {
  upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ id: "resp_1" }))
  })
  proxy = await start(configFor(upstream.port), storage)

  await post(
    proxy.port,
    "/v1/responses",
    { "user-agent": "codex_cli_rs/0.4.0" },
    { model: "gpt-5", input: "hey", stream: true }
  )

  const [exchange] = await loggedExchanges()
  expect(exchange!.source).toBe("codex")
  expect(exchange!.provider_format).toBe("openai")
  expect(exchange!.is_streaming).toBe(true)
  expect(exchange!.upstream_host).toBe(`127.0.0.1:${upstream.port}`)
})

it("infers source and format from payload shape when the user agent is unknown", async () => {
  upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end("{}")
  })
  proxy = await start(configFor(upstream.port), storage)

  await post(
    proxy.port,
    "/proxy-me",
    { "user-agent": "curl/8.0.0" },
    { system: "be brief", messages: [] }
  )

  const [exchange] = await loggedExchanges()
  expect(exchange!.provider_format).toBe("anthropic")
  expect(exchange!.source).toBe("claude-code")
})

it("forwards upstream errors verbatim without retrying", async () => {
  upstream = await startUpstream((_req, res) => {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "30" })
    res.end(JSON.stringify({ error: { type: "rate_limit_error" } }))
  })
  proxy = await start(configFor(upstream.port), storage)

  const response = await post(proxy.port, "/v1/messages", {}, { model: "claude-sonnet-5" })

  expect(response.status).toBe(429)
  expect(response.headers.get("retry-after")).toBe("30")
  expect(JSON.parse(response.text)).toEqual({ error: { type: "rate_limit_error" } })
  expect(upstream.calls).toHaveLength(1)

  const [exchange] = await loggedExchanges()
  expect(exchange!.status_code).toBe(429)
  expect(exchange!.proxy_error).toBeNull()
  expect(exchange!.response_complete).toBe(true)
})

it("records a proxy_error when the upstream is unreachable", async () => {
  const dead = await startUpstream(() => {})
  const deadPort = dead.port
  await dead.close()
  proxy = await start(configFor(deadPort), storage)

  const response = await post(proxy.port, "/v1/messages", {}, { model: "claude-sonnet-5" })

  expect(response.status).toBe(502)
  expect(JSON.parse(response.text).error.type).toBe("proxy_error")

  const [exchange] = await loggedExchanges()
  expect(exchange!.proxy_error).toContain("ECONNREFUSED")
  expect(exchange!.status_code).toBeNull()
  expect(exchange!.response_complete).toBe(false)
})

const SSE_EVENTS = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
]

it("streams SSE chunks through to the client and persists each one in order", async () => {
  upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    void (async () => {
      for (const event of SSE_EVENTS) {
        res.write(event)
        await sleep(40)
      }
      res.end()
    })()
  })
  proxy = await start(configFor(upstream.port), storage)

  const { status, arrivals, failed } = await postStreaming(proxy.port, "/v1/messages", {
    model: "claude-sonnet-5",
    stream: true,
    messages: [{ role: "user", content: "hey" }]
  })

  expect(status).toBe(200)
  expect(failed).toBe(false)
  expect(arrivals.length).toBeGreaterThanOrEqual(SSE_EVENTS.length)
  // Progressive delivery: the first bytes reach the client long before the last ones.
  expect(arrivals[0]!.at).toBeLessThan(arrivals[arrivals.length - 1]!.at - 20)
  expect(arrivals.map((arrival) => arrival.text).join("")).toBe(SSE_EVENTS.join(""))

  const exchange = await settledExchange()
  expect(exchange.is_streaming).toBe(true)
  expect(exchange.status_code).toBe(200)
  expect(exchange.response_headers!["content-type"]).toBe("text/event-stream")
  expect(exchange.response_body).toBeNull()
  expect(exchange.response_complete).toBe(true)
  expect(exchange.proxy_error).toBeNull()

  const chunks = await Effect.runPromise(Effect.orDie(storage.getChunks(exchange.id)))
  expect(chunks.length).toBeGreaterThanOrEqual(SSE_EVENTS.length)
  expect(chunks.map((chunk) => chunk.sequence)).toEqual(chunks.map((_, index) => index))
  expect(chunks.map((chunk) => text(chunk.raw_data)).join("")).toBe(SSE_EVENTS.join(""))
})

it("marks the exchange incomplete when the upstream drops mid-stream", async () => {
  upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" })
    res.write(SSE_EVENTS[0]!)
    setTimeout(() => res.socket?.destroy(), 40)
  })
  proxy = await start(configFor(upstream.port), storage)

  const { arrivals } = await postStreaming(proxy.port, "/v1/messages", {
    model: "claude-sonnet-5",
    stream: true,
    messages: [{ role: "user", content: "hey" }]
  })

  expect(arrivals.map((arrival) => arrival.text).join("")).toBe(SSE_EVENTS[0])

  const exchange = await settledExchange()
  expect(exchange.response_complete).toBe(false)
  expect(exchange.proxy_error).not.toBeNull()

  const chunks = await Effect.runPromise(Effect.orDie(storage.getChunks(exchange.id)))
  expect(chunks).toHaveLength(1)
  expect(text(chunks[0]!.raw_data)).toBe(SSE_EVENTS[0])
})

it("defaults to a loopback bind and the real provider endpoints", () => {
  expect(defaultConfig.host).toBe("127.0.0.1")
  expect(defaultConfig.upstreams).toEqual({
    anthropic: "https://api.anthropic.com",
    openai: "https://api.openai.com"
  })
})
