import { buildCollectionAnalytics } from '@/lib/collection-analytics';
import { type CardPriceSnapshot, getCardPriceKey, type SupportedCurrency } from '@/hooks/use-card-prices';
import type { CardFinish, CardLanguage, SlotStatus, WantedCard, CollectedPokemon } from '@/lib/domain/cards';
import { peekCardsForPokemon } from '@/hooks/use-tcgdex';
import { matchesCatalogCardId } from '@/lib/card-catalog';
import { toCardImageSrc } from '@/lib/card-image-url';
import { ARTWORK_DETAIL_WIDTH, getOfficialArtworkUrl, type PokemonSummary } from '@/lib/pokemon-catalog';

export { GENERATIONS } from '@/lib/pokemon-generations';

/**
 * A card's illustrator without a request: saved on a wanted card, or from the Pokémon's card list when it is
 * already loaded. "" means the card has no credit; null means it is not known yet.
 */
export function getKnownCardIllustrator(
  pokemonId: number,
  cardId: string,
  wantedCards: WantedCard[] | undefined,
): string | null {
  const saved = wantedCards?.find((card) => card.card_id === cardId)?.illustrator?.trim();
  if (saved) return saved;
  const loaded = peekCardsForPokemon(pokemonId, 'en');
  if (!loaded) return null;
  return loaded.find((card) => matchesCatalogCardId(card, cardId))?.illustrator?.trim() || '';
}

export const BINDER_PAGE_QUERY_PARAM = 'page';

export const THEME_COLOR_LIGHT = '#f7f6fb';

export const THEME_COLOR_DARK = '#07070a';

export type SlotGlareState = {
  offsetX: number;
  offsetY: number;
  angle: number;
  opacity: number;
};

export type MotionGlintStatus =
  'disabled' | 'needs-permission' | 'requesting' | 'active' | 'fallback' | 'denied' | 'unsupported';

export const DEFAULT_SLOT_GLARE_STATE = {
  offsetX: -24,
  offsetY: -18,
  angle: -26,
  opacity: 1,
} satisfies SlotGlareState;

export function getSlotGlareState(offsetX: number, offsetY: number, angle: number, opacity = 1): SlotGlareState {
  return { offsetX, offsetY, angle, opacity };
}

export type DeviceOrientationPermissionState = 'granted' | 'denied';

export type DeviceOrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<DeviceOrientationPermissionState>;
};

export type DeviceMotionWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<DeviceOrientationPermissionState>;
};

import type { CollectionViewFilter } from '@/lib/collection-view-filter';
export type { CollectionViewFilter } from '@/lib/collection-view-filter';

export type ActiveMainView = 'binder' | 'list' | 'wanted' | 'sets' | 'pokemon' | 'analytics';

export const COLLECTION_VIEW_FILTERS: Array<{
  id: CollectionViewFilter;
  label: string;
  mobileLabel: string;
  description: string;
}> = [
  {
    id: 'all',
    label: 'All',
    mobileLabel: 'All',
    description: 'Show the full binder, including empty, upgradeable, and perfect slots.',
  },
  { id: 'owned', label: 'Owned', mobileLabel: 'Owned', description: 'Only show slots with a card in them.' },
  { id: 'needed', label: 'Need', mobileLabel: 'Need', description: 'Only show slots that still need collecting.' },
  { id: 'wanted', label: 'Wanted', mobileLabel: 'Wanted', description: 'Only show slots with cards on the want list.' },
  {
    id: 'upgradeable',
    label: 'Upgrades',
    mobileLabel: 'Upgrades',
    description: 'Show collected slots that are not marked perfect yet.',
  },
  {
    id: 'favorite',
    label: 'Perfect',
    mobileLabel: 'Perfect',
    description: 'Show slots that are done and marked as the perfect card.',
  },
];

export type QuickPanelPosition = {
  top: number;
  left: number;
  maxHeight: number;
};

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type DisplaySpreadPage =
  | { kind: 'info'; side: 'left' | 'right' }
  | { kind: 'blank'; side: 'left' | 'right' }
  | { kind: 'binder'; pageNumber: number; side: 'left' | 'right' };

export interface InitialCollectionRow {
  id: string;
  pokemon_id: number;
  pokemon_name: string;
  card_id?: string;
  card_name?: string;
  card_image?: string;
  card_set?: string;
  card_language?: CardLanguage;
  card_finish?: CardFinish;
  wanted_cards?: WantedCard[];
  status: SlotStatus;
  collected_at: string;
}

export function getPokemonArtwork(pokemon: PokemonSummary) {
  return pokemon.sprites.other['official-artwork'].front_default;
}

// The detail sheet shows the artwork larger than a binder slot.
export function getDetailArtwork(pokemon: PokemonSummary, cardImage?: string | null) {
  return toCardImageSrc(cardImage) || getOfficialArtworkUrl(pokemon.id, ARTWORK_DETAIL_WIDTH);
}

export function getDisplayArtworkTone(status?: SlotStatus) {
  return status === 'wishlisted' ? 'grayscale saturate-[0.8] brightness-[0.92]' : '';
}

export function getWantedCardKey(card: WantedCard) {
  return `${card.card_id}:${card.card_language ?? 'en'}:${card.card_finish ?? 'normal'}`;
}

export const CARD_FINISH_OPTIONS: Array<{ id: CardFinish; label: string }> = [
  { id: 'normal', label: 'Normal' },
  { id: 'holo', label: 'Holo' },
  { id: 'reverse_holo', label: 'Reverse' },
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

export function getCollectionItemPriceKey(item?: { card_id?: string | null; card_language?: string | null } | null) {
  return item?.card_id ? getCardPriceKey(item.card_id, item.card_language) : null;
}

const COLLECTED_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function formatCollectedDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return COLLECTED_DATE_FORMAT.format(date);
}

export type PriceSummary = {
  gbpTotal: number;
  originalTotals: Partial<Record<Exclude<SupportedCurrency, 'GBP'>, number>>;
  unpricedCount: number;
};

/** Binder totals share Analytics' finish matching, provider selection and freshness rules. */
export function summarizeOwnedCardPrices(
  collection: CollectedPokemon[],
  prices: Parameters<typeof buildCollectionAnalytics>[1],
  now = Date.now(),
) {
  const summary = buildCollectionAnalytics(collection, prices, now);
  return {
    gbpTotal: summary.valueGbp,
    originalTotals: {},
    unpricedCount: summary.assignedCards - summary.pricedCards,
    estimatedFinishCount: summary.estimatedFinishCards,
  };
}

export function sumPriceSnapshots(prices: Array<CardPriceSnapshot | undefined>): PriceSummary {
  let gbpTotal = 0;
  const originalTotals: Partial<Record<Exclude<SupportedCurrency, 'GBP'>, number>> = {};
  let unpricedCount = 0;

  for (const price of prices) {
    if (price?.gbpAmount == null) {
      unpricedCount += 1;
      continue;
    }

    gbpTotal += price.gbpAmount;

    if (price.originalCurrency && price.originalAmount != null) {
      originalTotals[price.originalCurrency] = (originalTotals[price.originalCurrency] || 0) + price.originalAmount;
    }
  }

  return { gbpTotal, originalTotals, unpricedCount };
}

export function combinePriceSummaries(summaries: PriceSummary[]): PriceSummary {
  const combined: PriceSummary = { gbpTotal: 0, originalTotals: {}, unpricedCount: 0 };

  for (const summary of summaries) {
    combined.gbpTotal += summary.gbpTotal;
    combined.unpricedCount += summary.unpricedCount;

    for (const [currency, amount] of Object.entries(summary.originalTotals)) {
      if (!amount) continue;
      const supportedCurrency = currency as Exclude<SupportedCurrency, 'GBP'>;
      combined.originalTotals[supportedCurrency] = (combined.originalTotals[supportedCurrency] || 0) + amount;
    }
  }

  return combined;
}

/** The share-link endpoint for one binder (the owner's default when unknown). */
export function binderShareUrl(binderId: string | null) {
  return binderId ? `/app/api/binder-share?binderId=${encodeURIComponent(binderId)}` : '/app/api/binder-share';
}
