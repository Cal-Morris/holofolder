// Shared card domain types and normalizers. Isomorphic: safe to import from
// client components, hooks, API routes and workflows.

export const CARD_LANGUAGES = ['en', 'fr', 'de', 'es', 'it', 'pt-br', 'ja', 'ko'] as const;
export type CardLanguage = (typeof CARD_LANGUAGES)[number];
export const DEFAULT_CARD_LANGUAGE: CardLanguage = 'en';

export const CARD_FINISHES = [
  'normal',
  'holo',
  'reverse_holo',
  'double_rare',
  'ultra_rare',
  'illustration_rare',
  'special_illustration_rare',
  'secret_rare',
  'hyper_rare',
  'radiant_rare',
  'ace_spec',
  'amazing_rare',
  'shiny_rare',
  'jumbo',
] as const;
export type CardFinish = (typeof CARD_FINISHES)[number];
export const DEFAULT_CARD_FINISH: CardFinish = 'normal';

export const SLOT_STATUSES = ['collected', 'finalized', 'considering', 'wishlisted'] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

const CARD_LANGUAGE_SET: ReadonlySet<string> = new Set(CARD_LANGUAGES);
const CARD_FINISH_SET: ReadonlySet<string> = new Set(CARD_FINISHES);
const SLOT_STATUS_SET: ReadonlySet<string> = new Set(SLOT_STATUSES);

export function isCardLanguage(value: unknown): value is CardLanguage {
  return typeof value === 'string' && CARD_LANGUAGE_SET.has(value);
}

export function isCardFinish(value: unknown): value is CardFinish {
  return typeof value === 'string' && CARD_FINISH_SET.has(value);
}

export function isSlotStatus(value: unknown): value is SlotStatus {
  return typeof value === 'string' && SLOT_STATUS_SET.has(value);
}

/** Case- and whitespace-insensitive; anything unknown falls back to English. */
export function normalizeCardLanguage(value: unknown): CardLanguage {
  if (typeof value !== 'string') return DEFAULT_CARD_LANGUAGE;
  const normalized = value.trim().toLowerCase();
  return isCardLanguage(normalized) ? normalized : DEFAULT_CARD_LANGUAGE;
}

/** Exact match only (finishes are stored as snake_case ids); unknown falls back to "normal". */
export function normalizeCardFinish(value: unknown): CardFinish {
  return isCardFinish(value) ? value : DEFAULT_CARD_FINISH;
}

export interface WantedCard {
  card_id: string;
  card_name: string;
  card_image?: string;
  card_set?: string;
  card_language?: CardLanguage;
  card_finish?: CardFinish;
  rarity?: string;
  local_id?: string;
  set_total?: number;
  illustrator?: string;
  added_at: string;
  /** Omitted on legacy wants; an empty list explicitly means Unassigned. */
  wanted_by?: string[];
}

export function normalizeWantedPeople(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Array.from(
    new Set(
      value
        .filter(
          (id): id is string =>
            typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
        )
        .map((id) => id.toLowerCase()),
    ),
  )
    .sort()
    .slice(0, 2);
}

export interface CollectedPokemon {
  id: string;
  pokemon_id: number;
  pokemon_name: string;
  card_id?: string;
  card_name?: string;
  card_image?: string;
  card_set?: string;
  card_language?: CardLanguage;
  card_finish?: CardFinish;
  wanted_cards: WantedCard[];
  status: SlotStatus;
  collected_at: string;
}

/** Global opaque application IDs, shared across games/providers. Provider-local IDs are not aliases. */
export interface CardCatalogIdentity {
  canonicalId?: string;
  aliasIds?: string[];
}

export interface TCGCard extends CardCatalogIdentity {
  id: string;
  localId: string;
  name: string;
  image?: string;
  language?: CardLanguage;
  /** Languages this printing exists in; absent when unknown. */
  languages?: CardLanguage[];
  set: {
    id: string;
    name: string;
    logo?: string;
    officialCardCount?: number;
  };
  rarity?: string;
  variants?: {
    normal?: boolean;
    reverse?: boolean;
    holo?: boolean;
    firstEdition?: boolean;
    wPromo?: boolean;
    jumbo?: boolean;
  };
  hp?: number;
  types?: string[];
  illustrator?: string;
}
