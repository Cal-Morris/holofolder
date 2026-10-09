// Binder settings: one set of defaults and one mapping between the `user_settings`
// row (snake_case) and the BinderSettings shape used by pages, API routes and the hook.
import { DEFAULT_BINDER_COLOR_ID, type BinderColorId } from "@/lib/binder-colors"

export interface BinderSettings {
  binderRows: number
  binderCols: number
  binderColorId: BinderColorId
  binderPageColors: Record<string, BinderColorId>
  binderSlotGlareEnabled: boolean
  cardFinishEffectsEnabled: boolean
  darkMode: boolean
}

export const DEFAULT_BINDER_SETTINGS: Readonly<BinderSettings> = Object.freeze({
  binderRows: 4,
  binderCols: 4,
  binderColorId: DEFAULT_BINDER_COLOR_ID,
  binderPageColors: {},
  binderSlotGlareEnabled: true,
  cardFinishEffectsEnabled: true,
  darkMode: true,
})

export const USER_SETTINGS_COLUMNS =
  "binder_rows, binder_cols, binder_color_id, binder_page_colors, binder_slot_glare_enabled, card_finish_effects_enabled, dark_mode"

export interface UserSettingsRow {
  binder_rows?: number | null
  binder_cols?: number | null
  binder_color_id?: string | null
  binder_page_colors?: Record<string, BinderColorId> | null
  binder_slot_glare_enabled?: boolean | null
  card_finish_effects_enabled?: boolean | null
  dark_mode?: boolean | null
}

export function getDefaultBinderSettings(): BinderSettings {
  return { ...DEFAULT_BINDER_SETTINGS, binderPageColors: {} }
}

function readGridSize(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function readPageColors(value: unknown, fallback: Record<string, BinderColorId>) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, BinderColorId>)
    : fallback
}

/** Maps a `user_settings` row (or nothing) to BinderSettings; invalid grid sizes fall back to the defaults. */
export function settingsFromRow(row: UserSettingsRow | null | undefined): BinderSettings {
  const defaults = getDefaultBinderSettings()

  return {
    binderRows: readGridSize(row?.binder_rows, defaults.binderRows),
    binderCols: readGridSize(row?.binder_cols, defaults.binderCols),
    binderColorId: (row?.binder_color_id as BinderColorId | null | undefined) || defaults.binderColorId,
    binderPageColors: readPageColors(row?.binder_page_colors, defaults.binderPageColors),
    binderSlotGlareEnabled: row?.binder_slot_glare_enabled ?? defaults.binderSlotGlareEnabled,
    cardFinishEffectsEnabled: row?.card_finish_effects_enabled ?? defaults.cardFinishEffectsEnabled,
    darkMode: row?.dark_mode ?? defaults.darkMode,
  }
}

/** Maps BinderSettings to the `user_settings` columns (without `user_id`). */
export function settingsToRow(settings: BinderSettings): Required<UserSettingsRow> {
  return {
    binder_rows: settings.binderRows,
    binder_cols: settings.binderCols,
    binder_color_id: settings.binderColorId,
    binder_page_colors: settings.binderPageColors,
    binder_slot_glare_enabled: settings.binderSlotGlareEnabled,
    card_finish_effects_enabled: settings.cardFinishEffectsEnabled,
    dark_mode: settings.darkMode,
  }
}

export type StoredBinderSettings = Partial<BinderSettings> & {
  /** Legacy local-storage keys from before the binder* rename. */
  rows?: number
  cols?: number
}

/** Normalizes camelCase settings from local storage or the settings API onto a fallback. */
export function normalizeBinderSettings(
  source: StoredBinderSettings | null | undefined,
  fallback: BinderSettings,
): BinderSettings {
  if (!source || typeof source !== "object") {
    return fallback
  }

  return {
    binderRows: readGridSize(source.binderRows, readGridSize(source.rows, fallback.binderRows)),
    binderCols: readGridSize(source.binderCols, readGridSize(source.cols, fallback.binderCols)),
    binderColorId: source.binderColorId || fallback.binderColorId,
    binderPageColors: readPageColors(source.binderPageColors, fallback.binderPageColors),
    binderSlotGlareEnabled: source.binderSlotGlareEnabled ?? fallback.binderSlotGlareEnabled,
    cardFinishEffectsEnabled: source.cardFinishEffectsEnabled ?? fallback.cardFinishEffectsEnabled,
    darkMode: source.darkMode ?? fallback.darkMode,
  }
}
