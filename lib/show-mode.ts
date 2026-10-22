// Card show mode: a device-local switch for using BinderDex at a card show. With it on, Search opens
// Quick mode, the screen stays awake and a banner shows how to leave. Pure helpers; the hook is
// hooks/use-show-mode.ts.

export const SHOW_MODE_KEY = "binderdex:show-mode:v1"
export const SHOW_MODE_PROMPT_KEY = "binderdex:show-mode-prompt:v1"
/** Fired on window when this tab changes Show mode (the storage event covers other tabs). */
export const SHOW_MODE_EVENT = "binderdex:show-mode"
/** "Not now" on the binder's Show mode card hides it for this long (it still shows when offline). */
export const SHOW_MODE_PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

export interface ShowModeState {
  on: boolean
  since: string | null
}

export const SHOW_MODE_OFF: ShowModeState = { on: false, since: null }

export function parseShowMode(raw: string | null | undefined): ShowModeState {
  if (!raw) return SHOW_MODE_OFF
  try {
    const parsed = JSON.parse(raw) as Partial<ShowModeState> | null
    if (!parsed || parsed.on !== true) return SHOW_MODE_OFF
    return { on: true, since: typeof parsed.since === "string" ? parsed.since : null }
  } catch {
    return SHOW_MODE_OFF
  }
}

export function serializeShowMode(on: boolean, now = new Date()): string {
  return JSON.stringify(on ? { on: true, since: now.toISOString() } : SHOW_MODE_OFF)
}

/** Whether the binder should offer Show mode: never while it's on; always when offline; else unless snoozed. */
export function shouldOfferShowMode({
  showModeOn,
  isOnline,
  snoozedAt,
  now = Date.now(),
}: {
  showModeOn: boolean
  isOnline: boolean
  snoozedAt: number | null
  now?: number
}) {
  if (showModeOn) return false
  if (!isOnline) return true
  return snoozedAt === null || now - snoozedAt >= SHOW_MODE_PROMPT_SNOOZE_MS
}

export function parsePromptSnooze(raw: string | null | undefined): number | null {
  const value = Number(raw)
  return raw && Number.isFinite(value) && value > 0 ? value : null
}
