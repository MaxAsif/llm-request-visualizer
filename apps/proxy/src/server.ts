import { randomUUID } from "node:crypto"
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse
} from "node:http"
import { request as httpsRequest } from "node:https"
import type { Chunk, Exchange, Headers, StorageService } from "@llmviz/storage"
import { Effect } from "effect"
import type { ProxyConfig } from "./config.js"
import { detect } from "./detect.js"

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
])

interface UpstreamResponse {
  readonly status: number
  readonly headers: Headers
  readonly body: Buffer
}

export interface ProxyHandle {
  readonly port: number
  readonly close: () => Promise<void>
}

const flattenHeaders = (headers: IncomingHttpHeaders): Headers => {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    out[name] = Array.isArray(value) ? value.join(", ") : value
  }
  return out
}

export const REDACTED = "[redacted]"

const redact = (headers: Headers, config: ProxyConfig): Headers => {
  if (!config.redactHeaders) return headers
  const sensitive = new Set(config.redactedHeaders)
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = sensitive.has(name.toLowerCase()) ? REDACTED : value
  }
  return out
}

const readBody = (stream: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    stream.on("data", (part: Buffer) => parts.push(part))
    stream.on("end", () => resolve(Buffer.concat(parts)))
    stream.on("error", reject)
  })

const parseJson = (body: Buffer): Record<string, unknown> | undefined => {
  if (body.length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"))
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

const open = (
  target: URL,
  method: string,
  path: string,
  headers: Headers,
  body: Buffer
): Promise<IncomingMessage> => {
  const outbound: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue
    outbound[name] = value
  }
  outbound["host"] = target.host
  outbound["content-length"] = String(body.length)
  // Identity encoding keeps stored response bodies readable for the canonical layer.
  outbound["accept-encoding"] = "identity"

  const send = target.protocol === "https:" ? httpsRequest : httpRequest

  return new Promise((resolve, reject) => {
    const req = send(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port === "" ? undefined : Number(target.port),
        method,
        path,
        headers: outbound
      },
      resolve
    )
    req.on("error", reject)
    req.end(body)
  })
}

const forward = async (
  target: URL,
  method: string,
  path: string,
  headers: Headers,
  body: Buffer
): Promise<UpstreamResponse> => {
  const res = await open(target, method, path, headers, body)
  return {
    status: res.statusCode ?? 502,
    headers: flattenHeaders(res.headers),
    body: await readBody(res)
  }
}

const respond = (res: ServerResponse, status: number, headers: Headers, body: Buffer): void => {
  for (const [name, value] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase()) || name.toLowerCase() === "content-length") continue
    res.setHeader(name, value)
  }
  res.setHeader("content-length", String(body.length))
  res.writeHead(status)
  res.end(body)
}

const beginStream = (res: ServerResponse, status: number, headers: Headers): void => {
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (HOP_BY_HOP.has(lower) || lower === "content-length") continue
    res.setHeader(name, value)
  }
  res.writeHead(status)
  res.flushHeaders()
}

interface StreamOutcome {
  readonly complete: boolean
  readonly error: string | null
}

export const start = async (
  config: ProxyConfig,
  storage: StorageService
): Promise<ProxyHandle> => {
  const persist = (exchange: Exchange): Promise<void> =>
    Effect.runPromise(
      storage.writeExchange(exchange).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => console.error("[llmviz] failed to persist exchange", error))
        )
      )
    )

  const persistChunk = (chunk: Chunk): Promise<void> =>
    Effect.runPromise(
      storage.appendChunk(chunk).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => console.error("[llmviz] failed to persist chunk", error))
        )
      )
    )

  const relay = (
    upstream: IncomingMessage,
    res: ServerResponse,
    exchangeId: string
  ): Promise<StreamOutcome> =>
    new Promise((resolve) => {
      let sequence = 0
      let settled = false
      // Chunk writes are chained so records land in `sequence` order regardless of how
      // the storage adapter schedules them.
      let writes: Promise<void> = Promise.resolve()

      const settle = (outcome: StreamOutcome): void => {
        if (settled) return
        settled = true
        writes.then(() => resolve(outcome))
      }

      upstream.on("data", (part: Buffer) => {
        if (!res.write(part)) {
          upstream.pause()
          res.once("drain", () => upstream.resume())
        }
        const chunk: Chunk = {
          id: randomUUID(),
          exchange_id: exchangeId,
          sequence: sequence++,
          timestamp: Date.now(),
          raw_data: new Uint8Array(part)
        }
        writes = writes.then(() => persistChunk(chunk))
      })

      upstream.on("end", () => {
        res.end()
        settle({ complete: true, error: null })
      })

      upstream.on("error", (cause: Error) => {
        res.destroy()
        settle({ complete: false, error: cause.message })
      })

      res.on("close", () => {
        upstream.destroy()
        settle({ complete: false, error: "client disconnected before the stream completed" })
      })
    })

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = req.url ?? "/"
    const requestHeaders = flattenHeaders(req.headers)
    const requestBody = await readBody(req)
    const detection = detect(path, requestHeaders, parseJson(requestBody))
    const target = new URL(config.upstreams[detection.provider_format])

    const exchange: Exchange = {
      id: randomUUID(),
      timestamp_start: Date.now(),
      timestamp_end: null,
      source: detection.source,
      provider_format: detection.provider_format,
      http_method: req.method ?? "GET",
      path,
      upstream_host: target.host,
      status_code: null,
      request_headers: redact(requestHeaders, config),
      request_body: new Uint8Array(requestBody),
      is_streaming: detection.is_streaming,
      response_headers: null,
      response_body: null,
      response_complete: false,
      proxy_error: null
    }
    await persist(exchange)

    try {
      if (detection.is_streaming) {
        const upstream = await open(target, exchange.http_method, path, requestHeaders, requestBody)
        const status = upstream.statusCode ?? 502
        const responseHeaders = flattenHeaders(upstream.headers)
        beginStream(res, status, responseHeaders)

        const outcome = await relay(upstream, res, exchange.id)
        await persist({
          ...exchange,
          timestamp_end: Date.now(),
          status_code: status,
          response_headers: responseHeaders,
          response_complete: outcome.complete,
          proxy_error: outcome.error
        })
        return
      }

      const upstream = await forward(target, exchange.http_method, path, requestHeaders, requestBody)
      await persist({
        ...exchange,
        timestamp_end: Date.now(),
        status_code: upstream.status,
        response_headers: upstream.headers,
        response_body: new Uint8Array(upstream.body),
        response_complete: true
      })
      respond(res, upstream.status, upstream.headers, upstream.body)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      await persist({ ...exchange, timestamp_end: Date.now(), proxy_error: message })
      const body = Buffer.from(
        JSON.stringify({ error: { type: "proxy_error", message } }),
        "utf8"
      )
      respond(res, 502, { "content-type": "application/json" }, body)
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((cause: unknown) => {
      console.error("[llmviz] proxy handler failed", cause)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve))
  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : config.port

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      })
  }
}
