export type Json = Record<string, unknown>

const decoder = new TextDecoder()

export const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const asString = (value: unknown): string => (typeof value === "string" ? value : "")

export const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null

export const asNumberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

export const asArray = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])

export const decodeBody = (bytes: Uint8Array | null): Json => {
  if (bytes === null || bytes.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(decoder.decode(bytes))
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export const decodeText = (bytes: Uint8Array): string => decoder.decode(bytes)

export const omit = (source: Json, keys: ReadonlyArray<string>): Json => {
  const result: Json = {}
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) result[key] = value
  }
  return result
}
