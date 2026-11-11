import { parseRecentCards, type RecentCard } from '@/lib/recent-cards';
import { DISPLAY_CURRENCIES, type DisplayCurrency } from '@/lib/pricing-region';

export interface RevisitCard {
  card: RecentCard;
  askingPrice: number | null;
  currency: DisplayCurrency;
  note: string;
  savedAt: string;
}

export const revisitKey = (card: RecentCard) =>
  `${card.canonicalId ?? card.id}:${card.language ?? 'en'}:${card.finish ?? 'normal'}`;
export const revisitStorageKey = (viewerId: string | null, ownerId: string | null) =>
  viewerId && ownerId ? `holofolder:show-revisit:v1:${viewerId}:${ownerId}` : null;

export function parseRevisitCards(raw: string | null | undefined): RevisitCard[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    const cards: RevisitCard[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const card = parseRecentCards(JSON.stringify([item.card]))[0];
      if (
        !card ||
        seen.has(revisitKey(card)) ||
        !DISPLAY_CURRENCIES.includes(item.currency) ||
        !(
          item.askingPrice === null ||
          (typeof item.askingPrice === 'number' && Number.isFinite(item.askingPrice) && item.askingPrice > 0)
        ) ||
        typeof item.note !== 'string' ||
        typeof item.savedAt !== 'string' ||
        !Number.isFinite(Date.parse(item.savedAt))
      )
        continue;
      cards.push({
        card,
        askingPrice: item.askingPrice,
        currency: item.currency,
        note: item.note.slice(0, 500),
        savedAt: item.savedAt,
      });
      seen.add(revisitKey(card));
    }
    return cards;
  } catch {
    return [];
  }
}

export function saveRevisitCard(cards: readonly RevisitCard[], entry: RevisitCard): RevisitCard[] {
  return [entry, ...cards.filter((item) => revisitKey(item.card) !== revisitKey(entry.card))];
}

/** A saved offer is usable only in its own currency; late price/FX data must not overwrite typing. */
export function revisitAskingInput(
  entry: RevisitCard | undefined,
  currency: DisplayCurrency,
  edited: string | null,
): string {
  if (edited !== null) return edited;
  return entry?.currency === currency && entry.askingPrice !== null ? String(entry.askingPrice) : '';
}
