import { isCardFinish, type CardFinish, type CardCatalogIdentity } from '@/lib/domain/cards';
import { readCatalogMetadata } from '@/lib/card-catalog';
import { formatCardNumber, type SearchCardResult } from '@/lib/pokemon-card-browse';

export const RECENT_CARDS_STORAGE_KEY = 'binderdex:recent-cards:v1';
export const RECENT_CARDS_LIMIT = 20;

/** A card opened from search, kept on this device so it can be reopened from an empty search. */
export interface RecentCard extends CardCatalogIdentity {
  id: string;
  name: string;
  number: string;
  setName: string;
  image?: string;
  language?: string;
  dexId: number;
  pokemonName: string;
  localId?: string;
  setId?: string;
  officialCardCount?: number;
  rarity?: string;
  variants?: SearchCardResult['variants'];
  finish?: CardFinish;
  viewedAt: string;
}

export function toRecentCard(
  card: SearchCardResult,
  pokemon: { id: number; name: string },
  viewedAt = new Date().toISOString(),
  finish?: CardFinish | null,
): RecentCard {
  return {
    id: card.id,
    ...(card.canonicalId ? { canonicalId: card.canonicalId } : {}),
    ...(card.aliasIds ? { aliasIds: card.aliasIds } : {}),
    name: card.name,
    number: formatCardNumber(card),
    setName: card.set.name,
    ...(card.image ? { image: card.image } : {}),
    ...(card.language ? { language: card.language } : {}),
    dexId: pokemon.id,
    pokemonName: pokemon.name,
    localId: card.localId,
    setId: card.set.id,
    ...(card.set.officialCardCount ? { officialCardCount: card.set.officialCardCount } : {}),
    ...(card.rarity ? { rarity: card.rarity } : {}),
    ...(card.variants ? { variants: card.variants } : {}),
    ...(finish ? { finish } : {}),
    viewedAt,
  };
}

/** Older history only stored the displayed number; recover it without fetching a card. */
export function recentToSearchCard(card: RecentCard): SearchCardResult {
  const [localId, total] = card.number.replace(/^#/, '').split('/');
  return {
    id: card.id,
    name: card.name,
    localId: card.localId ?? localId,
    image: card.image,
    language: card.language,
    dexIds: [card.dexId],
    set: {
      id: card.setId ?? card.id.slice(0, card.id.lastIndexOf('-')),
      name: card.setName,
      officialCardCount: card.officialCardCount ?? (Number(total) > 0 ? Number(total) : undefined),
    },
    rarity: card.rarity,
    variants: card.variants,
    ...(card.canonicalId ? { canonicalId: card.canonicalId } : {}),
    ...(card.aliasIds ? { aliasIds: card.aliasIds } : {}),
  };
}

/** Newest first; viewing a card again moves it to the front instead of listing it twice. */
export function addRecentCard(list: RecentCard[], card: RecentCard, limit = RECENT_CARDS_LIMIT): RecentCard[] {
  return [card, ...list.filter((entry) => entry.id !== card.id)].slice(0, limit);
}

function isRecentCard(value: unknown): value is RecentCard {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.name === 'string' &&
    typeof entry.number === 'string' &&
    typeof entry.setName === 'string' &&
    typeof entry.pokemonName === 'string' &&
    typeof entry.viewedAt === 'string' &&
    Number.isInteger(entry.dexId) &&
    (entry.dexId as number) > 0 &&
    (entry.image === undefined || typeof entry.image === 'string') &&
    (entry.language === undefined || typeof entry.language === 'string')
  );
}

/** Reads a stored list, dropping malformed or duplicate entries rather than failing. */
export function parseRecentCards(raw: string | null | undefined): RecentCard[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const cards: RecentCard[] = [];
    for (const entry of parsed) {
      if (!isRecentCard(entry) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      // Optional printing details were added to v1; keep old entries and discard invalid extras.
      const { localId, setId, officialCardCount, rarity, variants, finish, canonicalId, aliasIds, ...base } = entry;
      cards.push({
        ...base,
        ...readCatalogMetadata({ catalog: { canonicalId, aliasIds } }),
        ...(typeof localId === 'string' ? { localId } : {}),
        ...(typeof setId === 'string' ? { setId } : {}),
        ...(typeof officialCardCount === 'number' && officialCardCount > 0 ? { officialCardCount } : {}),
        ...(typeof rarity === 'string' ? { rarity } : {}),
        ...(variants && typeof variants === 'object'
          ? {
              variants: Object.fromEntries(
                Object.entries(variants).filter(
                  ([key, value]) =>
                    ['normal', 'reverse', 'holo', 'firstEdition', 'wPromo', 'jumbo'].includes(key) &&
                    typeof value === 'boolean',
                ),
              ),
            }
          : {}),
        ...(isCardFinish(finish) ? { finish } : {}),
      });
      if (cards.length === RECENT_CARDS_LIMIT) break;
    }
    return cards;
  } catch {
    return [];
  }
}

type RecentCardStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readRecentCards(storage: RecentCardStorage | undefined): RecentCard[] {
  try {
    return parseRecentCards(storage?.getItem(RECENT_CARDS_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Best effort: a full or blocked storage just means the list isn't remembered. */
export function writeRecentCards(storage: RecentCardStorage | undefined, cards: RecentCard[]) {
  try {
    if (cards.length) storage?.setItem(RECENT_CARDS_STORAGE_KEY, JSON.stringify(cards));
    else storage?.removeItem(RECENT_CARDS_STORAGE_KEY);
  } catch {
    // Ignore quota and privacy-mode errors.
  }
}
