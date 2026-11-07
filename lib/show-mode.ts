// Card show mode: a device-local switch for using Holo Folder at a card show. With it on, Search opens
// Quick mode, the screen stays awake and a banner shows how to leave. Pure helpers; the hook is
// hooks/use-show-mode.ts.

export const SHOW_MODE_KEY = "binderdex:show-mode:v1"
export const SHOW_MODE_PROMPT_KEY = "binderdex:show-mode-prompt:v1"
/** Fired on window when this tab changes Show mode (the storage event covers other tabs). */
export const SHOW_MODE_EVENT = "binderdex:show-mode"
/**
 * Show mode is for one day at a show, not forever: if the app hasn't been open for this long, the
 * next launch starts with it off again.
 */
export const SHOW_MODE_IDLE_MS = 4 * 60 * 60 * 1000

export interface ShowModeState {
  on: boolean
  since: string | null
  /** Last time the app was open with Show mode on. */
  seenAt?: string | null
}

export const SHOW_MODE_OFF: ShowModeState = { on: false, since: null }

/** Reads the stored switch; an "on" that hasn't been seen for SHOW_MODE_IDLE_MS reads as off. */
export function parseShowMode(raw: string | null | undefined, now = Date.now()): ShowModeState {
  if (!raw) return SHOW_MODE_OFF
  try {
    const parsed = JSON.parse(raw) as Partial<ShowModeState> | null
    if (!parsed || parsed.on !== true) return SHOW_MODE_OFF
    const since = typeof parsed.since === "string" ? parsed.since : null
    const seenAt = typeof parsed.seenAt === "string" ? parsed.seenAt : since
    const seen = seenAt ? Date.parse(seenAt) : Number.NaN
    if (!Number.isFinite(seen) || now - seen >= SHOW_MODE_IDLE_MS) return SHOW_MODE_OFF
    return { on: true, since, seenAt }
  } catch {
    return SHOW_MODE_OFF
  }
}

/** Whether the stored value says "on", ignoring how long ago (to tidy up an expired switch). */
export function isStoredOn(raw: string | null | undefined) {
  try {
    return Boolean(raw && (JSON.parse(raw) as Partial<ShowModeState> | null)?.on === true)
  } catch {
    return false
  }
}

export function serializeShowMode(on: boolean, now = new Date(), since?: string | null): string {
  return JSON.stringify(on ? { on: true, since: since ?? now.toISOString(), seenAt: now.toISOString() } : SHOW_MODE_OFF)
}

/**
 * Whether the binder should offer Show mode: never while it's on, and never again once it has been
 * dismissed or used (`dismissedAt` is set by "Not now" and by turning Show mode on).
 */
export function shouldOfferShowMode({
  showModeOn,
  dismissedAt,
}: {
  showModeOn: boolean
  dismissedAt: number | null
}) {
  return !showModeOn && dismissedAt === null
}

export function parsePromptSnooze(raw: string | null | undefined): number | null {
  const value = Number(raw)
  return raw && Number.isFinite(value) && value > 0 ? value : null
}
