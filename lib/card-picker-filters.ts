/**
 * Filter model for the card picker's "Filters · Sort" sheet. Pure, so the sheet, the active-filter
 * chips and the unit tests agree.
 *
 * "Variant" is one control: a printing variant (Normal, Holo, Reverse, 1st Edition) narrows the list to
 * printings that exist in it, and a finish (Normal, Holo, Reverse or a rarity finish such as IR) is what
 * gets recorded on the slot. "Any" leaves both to the picked card.
 */
import { isStandardFinishVariantKey, type CardFinishPrice } from '@/lib/card-pricing';
import type { CardFilters } from '@/hooks/use-tcgdex';
import type { CardFinish, CardLanguage, TCGCard } from '@/lib/domain/cards';
import { inferCardFinish } from '@/lib/pokemon-card-browse';
import { CARD_PICKER_SORTS, type CardPickerSort } from '@/lib/card-selector-sort';

export type CardPickerVariantChoice = 'any' | 'first_edition' | CardFinish;

export const CARD_PICKER_LANGUAGES: Array<{ id: CardLanguage; label: string; shortLabel: string }> = [
  { id: 'en', label: 'English', shortLabel: 'EN' },
  { id: 'it', label: 'Italian', shortLabel: 'IT' },
  { id: 'fr', label: 'French', shortLabel: 'FR' },
  { id: 'de', label: 'German', shortLabel: 'DE' },
  { id: 'es', label: 'Spanish', shortLabel: 'ES' },
  { id: 'pt-br', label: 'Portuguese', shortLabel: 'PT' },
  { id: 'ja', label: 'Japanese', shortLabel: 'JA' },
  { id: 'ko', label: 'Korean', shortLabel: 'KO' },
];

export const CARD_PICKER_VARIANTS: Array<{ id: CardPickerVariantChoice; label: string }> = [
  { id: 'any', label: 'Any' },
  { id: 'normal', label: 'Normal' },
  { id: 'holo', label: 'Holo' },
  { id: 'reverse_holo', label: 'Reverse' },
  { id: 'first_edition', label: '1st Edition' },
  { id: 'double_rare', label: 'Double' },
  { id: 'ultra_rare', label: 'Ultra' },
  { id: 'illustration_rare', label: 'IR' },
  { id: 'special_illustration_rare', label: 'SIR' },
  { id: 'secret_rare', label: 'Secret' },
  { id: 'hyper_rare', label: 'Hyper' },
  { id: 'radiant_rare', label: 'Radiant' },
  { id: 'ace_spec', label: 'ACE' },
  { id: 'amazing_rare', label: 'Amazing' },
  { id: 'shiny_rare', label: 'Shiny' },
];

const VARIANT_FILTERS: Partial<Record<CardPickerVariantChoice, string>> = {
  normal: 'normal',
  holo: 'holo',
  reverse_holo: 'reverse',
  first_edition: 'firstEdition',
};

/** The catalogue variant filter for a choice (undefined: no narrowing). */
export function getVariantFilter(choice: CardPickerVariantChoice) {
  return VARIANT_FILTERS[choice];
}

/** The finish recorded when a card is picked (null: infer it from the picked card). */
export function getRecordedFinish(choice: CardPickerVariantChoice): CardFinish | null {
  return choice === 'any' || choice === 'first_edition' ? null : choice;
}

export type CardPickerFilterKey = 'language' | 'set' | 'rarity' | 'variant' | 'sort';

export interface CardPickerFilterState {
  filters: CardFilters;
  language: CardLanguage;
  defaultLanguage: CardLanguage;
  variant: CardPickerVariantChoice;
  sort: CardPickerSort;
}

export interface CardPickerFilterChip {
  key: CardPickerFilterKey;
  label: string;
}

/** Active, non-default filters as removable chips, in a stable order. Search is not a chip. */
export function getActiveFilterChips(
  state: CardPickerFilterState,
  setNameById: (id: string) => string | undefined,
): CardPickerFilterChip[] {
  const chips: CardPickerFilterChip[] = [];
  if (state.sort !== 'default') {
    chips.push({
      key: 'sort',
      label: CARD_PICKER_SORTS.find((option) => option.id === state.sort)?.label ?? state.sort,
    });
  }
  if (state.language !== state.defaultLanguage) {
    chips.push({
      key: 'language',
      label: CARD_PICKER_LANGUAGES.find((language) => language.id === state.language)?.label ?? state.language,
    });
  }
  if (state.variant !== 'any') {
    chips.push({
      key: 'variant',
      label: CARD_PICKER_VARIANTS.find((variant) => variant.id === state.variant)?.label ?? state.variant,
    });
  }
  if (state.filters.set) chips.push({ key: 'set', label: setNameById(state.filters.set) ?? state.filters.set });
  if (state.filters.rarity) chips.push({ key: 'rarity', label: state.filters.rarity });
  return chips;
}

export type CardPickerStandardFinish = 'normal' | 'holo' | 'reverse_holo';

const STANDARD_FINISH_LABELS: Record<CardPickerStandardFinish, string> = {
  normal: 'Normal',
  holo: 'Holo',
  reverse_holo: 'Reverse',
};

/**
 * The finishes to ask about after a card is tapped. Empty when there is nothing to choose: the user
 * already chose a variant in Filters, the printing exists in only one standard finish, or its finish
 * comes from its rarity (IR, SIR, ex and so on).
 */
export function getCardPickerFinishChoices(
  variants: { normal?: boolean; holo?: boolean; reverse?: boolean; firstEdition?: boolean } | undefined,
  inferredFinish: CardFinish,
  variantChoice: CardPickerVariantChoice,
  finishPrices: readonly Pick<CardFinishPrice, 'finish' | 'variantKey' | 'gbpAmount'>[] = [],
): Array<{ finish: CardPickerStandardFinish; label: string }> {
  if (getRecordedFinish(variantChoice) !== null) return [];
  if (!(inferredFinish in STANDARD_FINISH_LABELS)) return [];
  // Catalogue flags can omit finishes that providers explicitly quote for the standard printing.
  const quoted = new Set(
    finishPrices
      .filter(
        (price) =>
          isStandardFinishVariantKey(price.variantKey) &&
          Number.isFinite(price.gbpAmount) &&
          (price.gbpAmount ?? 0) > 0,
      )
      .map((price) => price.finish),
  );
  const finishes: CardPickerStandardFinish[] = [];
  if (variants?.normal || quoted.has('normal')) finishes.push('normal');
  if (variants?.holo || quoted.has('holo')) finishes.push('holo');
  if (variants?.reverse || quoted.has('reverse_holo')) finishes.push('reverse_holo');
  return finishes.length > 1 ? finishes.map((finish) => ({ finish, label: STANDARD_FINISH_LABELS[finish] })) : [];
}

/** Finishes an owned copy can be corrected to: its printing's standard finishes, unless its pocket pins one. */
export function ownedCopyFinishChoices(
  card: Pick<TCGCard, 'rarity' | 'variants'> | undefined,
  pocketFinish: CardFinish | undefined,
) {
  if (!card || pocketFinish) return [];
  return getCardPickerFinishChoices(card.variants, inferCardFinish(card.rarity, card.variants), 'any');
}

/** Suggest the most expensive quoted finish; missing prices provide no suggestion. */
export function getCardPickerSuggestedFinish(
  choices: readonly { finish: CardPickerStandardFinish }[],
  amountFor: (finish: CardPickerStandardFinish) => number | null | undefined,
): CardPickerStandardFinish | null {
  let suggested: CardPickerStandardFinish | null = null;
  let highestAmount = 0;
  for (const { finish } of choices) {
    const amount = amountFor(finish);
    if (typeof amount === 'number' && Number.isFinite(amount) && amount > highestAmount) {
      suggested = finish;
      highestAmount = amount;
    }
  }
  return suggested;
}
