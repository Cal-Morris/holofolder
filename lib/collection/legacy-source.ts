/** Source bytes live in the existing pending queue and mirror, never in a second uploader. */
export interface LegacyQueueSource {
  legacyQueueSource: { version: 1; raw: string; digest: string; ordinals?: number[]; accepted?: number[] }
}
export function sourceDigest(raw: string) {
  // The digest is an index, not a security boundary. Acceptance also compares the exact source bytes.
  let hash = 2166136261
  for (let i = 0; i < raw.length; i++) hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619)
  return `${raw.length}:${(hash >>> 0).toString(16)}`
}
export function isLegacyQueueSource(value: unknown): value is LegacyQueueSource {
  if (!value || typeof value !== "object" || !("legacyQueueSource" in value)) return false
  const source = (value as LegacyQueueSource).legacyQueueSource
  const ordinals = (values: unknown) => values === undefined || (Array.isArray(values) && values.every(value => Number.isInteger(value) && value >= 0) && new Set(values).size === values.length)
  return Object.keys(value).length === 1 && !!source && typeof source === "object"
    && Object.keys(source).every(key => ["version", "raw", "digest", "ordinals", "accepted"].includes(key))
    && source.version === 1 && typeof source.raw === "string" && source.digest === sourceDigest(source.raw)
    && ordinals(source.ordinals) && ordinals(source.accepted)
    && (!source.ordinals || !source.accepted || source.accepted.every(ordinal => source.ordinals!.includes(ordinal)))
}
export function decodeQueueArray(raw: string | null): unknown[] | null {
  if (raw === null) return []
  try { const parsed: unknown = JSON.parse(raw); return Array.isArray(parsed) ? parsed : null } catch { return null }
}
