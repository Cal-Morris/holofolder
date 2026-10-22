/**
 * Filter model for the card picker's "Filters · Sort" sheet. Pure, so the sheet, the active-filter
 * chips and the unit tests agree.
 *
 * "Variant" is one control: a printing variant (Normal, Holo, Reverse, 1st Edition) narrows the list to
 * printings that exist in it, and a finish (Normal, Holo, Reverse or a rarity finish such as IR) is what
 * gets recorded on the slot. "Any" leaves both to the picked card.
 */
import type { CardFilters } from "@/hooks/use-tcgdex"
import type { CardFinish, CardLanguage } from "@/lib/domain/cards"
import { CARD_PICKER_SORTS, type CardPickerSort } from "@/lib/card-selector-sort"

export type CardPickerVariantChoice = "any" | "first_edition" | CardFinish

export const CARD_PICKER_LANGUAGES: Array<{ id: CardLanguage; label: string; shortLabel: string }> = [
  { id: "en", label: "English", shortLabel: "EN" },
  { id: "it", label: "Italian", shortLabel: "IT" },
  { id: "fr", label: "French", shortLabel: "FR" },
  { id: "de", label: "German", shortLabel: "DE" },
  { id: "es", label: "Spanish", shortLabel: "ES" },
  { id: "pt-br", label: "Portuguese", shortLabel: "PT" },
  { id: "ja", label: "Japanese", shortLabel: "JA" },
  { id: "ko", label: "Korean", shortLabel: "KO" },
]

export const CARD_PICKER_VARIANTS: Array<{ id: CardPickerVariantChoice; label: string }> = [
  { id: "any", label: "Any" },
  { id: "normal", label: "Normal" },
  { id: "holo", label: "Holo" },
  { id: "reverse_holo", label: "Reverse" },
  { id: "first_edition", label: "1st Edition" },
  { id: "double_rare", label: "Double" },
  { id: "ultra_rare", label: "Ultra" },
  { id: "illustration_rare", label: "IR" },
  { id: "special_illustration_rare", label: "SIR" },
  { id: "secret_rare", label: "Secret" },
  { id: "hyper_rare", label: "Hyper" },
  { id: "radiant_rare", label: "Radiant" },
  { id: "ace_spec", label: "ACE" },
  { id: "amazing_rare", label: "Amazing" },
  { id: "shiny_rare", label: "Shiny" },
]

const VARIANT_FILTERS: Partial<Record<CardPickerVariantChoice, string>> = {
  normal: "normal",
  holo: "holo",
  reverse_holo: "reverse",
  first_edition: "firstEdition",
}

/** The catalogue variant filter for a choice (undefined: no narrowing). */
export function getVariantFilter(choice: CardPickerVariantChoice) {
  return VARIANT_FILTERS[choice]
}

/** The finish recorded when a card is picked (null: infer it from the picked card). */
export function getRecordedFinish(choice: CardPickerVariantChoice): CardFinish | null {
  return choice === "any" || choice === "first_edition" ? null : choice
}

export type CardPickerFilterKey = "language" | "set" | "rarity" | "variant" | "sort"

export interface CardPickerFilterState {
  filters: CardFilters
  language: CardLanguage
  defaultLanguage: CardLanguage
  variant: CardPickerVariantChoice
  sort: CardPickerSort
}

export interface CardPickerFilterChip {
  key: CardPickerFilterKey
  label: string
}

/** Active, non-default filters as removable chips, in a stable order. Search is not a chip. */
export function getActiveFilterChips(state: CardPickerFilterState, setNameById: (id: string) => string | undefined): CardPickerFilterChip[] {
  const chips: CardPickerFilterChip[] = []
  if (state.sort !== "default") {
    chips.push({ key: "sort", label: CARD_PICKER_SORTS.find((option) => option.id === state.sort)?.label ?? state.sort })
  }
  if (state.language !== state.defaultLanguage) {
    chips.push({ key: "language", label: CARD_PICKER_LANGUAGES.find((language) => language.id === state.language)?.label ?? state.language })
  }
  if (state.variant !== "any") {
    chips.push({ key: "variant", label: CARD_PICKER_VARIANTS.find((variant) => variant.id === state.variant)?.label ?? state.variant })
  }
  if (state.filters.set) chips.push({ key: "set", label: setNameById(state.filters.set) ?? state.filters.set })
  if (state.filters.rarity) chips.push({ key: "rarity", label: state.filters.rarity })
  return chips
}
