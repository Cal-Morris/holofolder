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

/** A full original may include hidden account records, including nested retained sources. */
export function mayDownloadLegacyOriginal(raw: string, actorId: string | null) {
  const pending: unknown[] = [raw]
  const parsed = new Set<string>()
  let remaining = 100000
  while (pending.length) {
    if (--remaining < 0) return false
    const value = pending.pop()
    if (typeof value === "string") {
      if (parsed.has(value)) continue
      parsed.add(value)
      if (!/^[\s]*[\[{\"]/.test(value)) continue
      try { pending.push(JSON.parse(value)) } catch { /* Opaque historical data stays unchanged. */ }
    } else if (value && typeof value === "object") {
      const row = value as Record<string, unknown>
      if (row.kind === "account" && typeof row.actorUserId === "string" && row.actorUserId !== actorId) return false
      const values = Object.values(row)
      if (values.length > remaining - pending.length) return false
      pending.push(...values)
    }
  }
  return true
}
