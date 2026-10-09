/**
 * Interval between repeated card-price refresh passes in workflows/card-price-refresh.ts.
 *
 * Accepts an ms-style duration ("90m", "3h", "1d"). Anything unparseable, or outside
 * [MIN, MAX], falls back to the default so a bad request can't hammer the price providers
 * (e.g. "1s") or stall a workflow for weeks.
 */
export const MIN_REFRESH_INTERVAL_MS = 15 * 60 * 1000
export const MAX_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

const UNIT_MS = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 } as const

export type RefreshInterval = `${number}${keyof typeof UNIT_MS}`

export const DEFAULT_REFRESH_INTERVAL: RefreshInterval = "3h"

export function normalizeRefreshInterval(value: unknown): RefreshInterval {
  if (typeof value !== "string") return DEFAULT_REFRESH_INTERVAL

  const match = value.trim().toLowerCase().match(/^(\d+)(m|h|d)$/)
  if (!match) return DEFAULT_REFRESH_INTERVAL

  const amount = Number.parseInt(match[1], 10)
  const unit = match[2] as keyof typeof UNIT_MS
  const durationMs = amount * UNIT_MS[unit]
  if (durationMs < MIN_REFRESH_INTERVAL_MS || durationMs > MAX_REFRESH_INTERVAL_MS) return DEFAULT_REFRESH_INTERVAL

  return `${amount}${unit}`
}
