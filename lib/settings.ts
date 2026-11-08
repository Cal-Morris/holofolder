// Binder settings: one set of defaults and one mapping between the `user_settings`
// row (snake_case) and the BinderSettings shape used by pages, API routes and the hook.
import { DEFAULT_BINDER_COLOR_ID, type BinderColorId } from "@/lib/binder-colors"
import { isBinderGridSize } from "@/lib/binder-layout"
import type { CardLanguage } from "@/lib/card-pricing"
import {
  normalizeDisplayCurrency,
  normalizePreferredCardLanguage,
  normalizePricingRegion,
  type DisplayCurrency,
  type PricingRegion,
} from "@/lib/pricing-region"

export interface BinderSettings {
  binderRows: number
  binderCols: number
  binderColorId: BinderColorId
  binderPageColors: Record<string, BinderColorId>
  binderSlotGlareEnabled: boolean
  cardFinishEffectsEnabled: boolean
  darkMode: boolean
  showBinderValue: boolean
  /** null = automatic (from the browser locale); see lib/pricing-region.ts. */
  pricingRegion: PricingRegion | null
  /** null = derived from the region. */
  preferredCurrency: DisplayCurrency | null
  /** null = automatic (from the browser locale). */
  preferredCardLanguage: CardLanguage | null
}

export const DEFAULT_BINDER_SETTINGS: Readonly<BinderSettings> = Object.freeze({
  binderRows: 4,
  binderCols: 4,
  binderColorId: DEFAULT_BINDER_COLOR_ID,
  binderPageColors: {},
  binderSlotGlareEnabled: true,
  cardFinishEffectsEnabled: true,
  darkMode: true,
  showBinderValue: true,
  pricingRegion: null,
  preferredCurrency: null,
  preferredCardLanguage: null,
})

/** Columns that exist before migration 024. */
export const LEGACY_USER_SETTINGS_COLUMNS =
  "binder_rows, binder_cols, binder_color_id, binder_page_colors, binder_slot_glare_enabled, card_finish_effects_enabled, dark_mode"

/** Pricing preference columns added by scripts/028_user_pricing_preferences.sql. */
export const PRICING_PREFERENCE_COLUMNS = ["pricing_region", "preferred_currency", "preferred_card_language"] as const

export const PRE_VALUE_VISIBILITY_COLUMNS = `${LEGACY_USER_SETTINGS_COLUMNS}, ${PRICING_PREFERENCE_COLUMNS.join(", ")}`
export const USER_SETTINGS_COLUMNS = `${PRE_VALUE_VISIBILITY_COLUMNS}, show_binder_value`

export function withoutBinderValueColumn<T extends Record<string, unknown>>(row: T) {
  const { show_binder_value: _visibility, ...previous } = row
  return previous
}

/**
 * True when Postgres/PostgREST rejected a query because a column doesn't exist yet, i.e. migration
 * 024 hasn't been applied. Callers retry with the legacy columns so settings keep working.
 */
export function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code === "42703" || code === "PGRST204") return true
  return typeof message === "string" && /column .* (does not exist|could not be found)/i.test(message)
}

/** Drops the 024 pricing columns from a row so it can be written to a pre-024 table. */
export function withoutPricingPreferenceColumns<T extends Record<string, unknown>>(row: T) {
  const copy: Record<string, unknown> = { ...row }
  for (const column of PRICING_PREFERENCE_COLUMNS) delete copy[column]
  return copy as Omit<T, (typeof PRICING_PREFERENCE_COLUMNS)[number]>
}

export interface UserSettingsRow {
  binder_rows?: number | null
  binder_cols?: number | null
  binder_color_id?: string | null
  binder_page_colors?: Record<string, BinderColorId> | null
  binder_slot_glare_enabled?: boolean | null
  card_finish_effects_enabled?: boolean | null
  dark_mode?: boolean | null
  show_binder_value?: boolean | null
  pricing_region?: string | null
  preferred_currency?: string | null
  preferred_card_language?: string | null
}

export function getDefaultBinderSettings(): BinderSettings {
  return { ...DEFAULT_BINDER_SETTINGS, binderPageColors: {} }
}

function readGridSize(value: unknown, fallback: number) {
  return isBinderGridSize(value) ? value : fallback
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
    showBinderValue: typeof row?.show_binder_value === "boolean" ? row.show_binder_value : defaults.showBinderValue,
    pricingRegion: normalizePricingRegion(row?.pricing_region),
    preferredCurrency: normalizeDisplayCurrency(row?.preferred_currency),
    preferredCardLanguage: normalizePreferredCardLanguage(row?.preferred_card_language),
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
    show_binder_value: settings.showBinderValue,
    pricing_region: settings.pricingRegion,
    preferred_currency: settings.preferredCurrency,
    preferred_card_language: settings.preferredCardLanguage,
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
    showBinderValue: typeof source.showBinderValue === "boolean" ? source.showBinderValue : fallback.showBinderValue,
    pricingRegion: "pricingRegion" in source ? normalizePricingRegion(source.pricingRegion) : fallback.pricingRegion,
    preferredCurrency: "preferredCurrency" in source ? normalizeDisplayCurrency(source.preferredCurrency) : fallback.preferredCurrency,
    preferredCardLanguage: "preferredCardLanguage" in source
      ? normalizePreferredCardLanguage(source.preferredCardLanguage)
      : fallback.preferredCardLanguage,
  }
}
