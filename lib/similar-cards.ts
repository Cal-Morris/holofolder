/**
 * Similar cards: a card's nearest neighbours by picture (DINOv3 fingerprints in public.tcg_card_embeddings, see
 * scripts/116_tcg_card_embeddings.sql), split into other printings of the same artwork and cards with a similar look.
 * Pure logic, shared by the server read (lib/tcg-mirror.ts), the API routes and the client.
 */
import { isCardLanguage, type CardLanguage } from '@/lib/domain/cards';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

/**
 * Picture similarity alone can't tell a reprint from a different card: old WotC frames put unrelated cards near 0.8,
 * and template full arts (5ban Graphics GX/VSTAR, SAR layouts) pair different Pokémon above 0.9. So "same artwork"
 * also needs the same subject (a shared Pokédex number, else the same English name; Japanese prints have no English
 * name, so a Trainer or Energy matches one by illustrator instead), and then:
 * the same illustrator (or none credited) at SAME_ARTWORK_SIMILARITY, or any illustrator at SAME_ARTWORK_ANY_CREDIT
 * (credits differ between some Japanese and English prints). Picked by inspecting real pairs; examples are in the PR.
 */
export const SAME_ARTWORK_SIMILARITY = 0.78;
export const SAME_ARTWORK_ANY_CREDIT = 0.92;
export const SAME_ARTWORK_LIMIT = 24;
export const SIMILAR_LOOK_LIMIT = 12;
/** Neighbours read from the database: enough for both groups after duplicates are removed. */
export const SIMILAR_NEIGHBOUR_LIMIT = 60;

export interface SimilarNeighbour {
  cardId: string;
  lang: string;
  similarity: number;
}

/** What decides whether two cards show the same subject. */
export interface CardSubject {
  dexIds: readonly number[];
  illustrator?: string | null;
  /** English name, for cards without a Pokédex number. */
  name?: string | null;
  /** TCGdex category: Pokemon, Trainer or Energy. */
  category?: string | null;
}

export type SplitNeighbour = SimilarNeighbour & { lang: CardLanguage };

export interface SimilarCard extends SearchCardResult {
  /** Cosine similarity of the two pictures, 0 to 1 (1 = identical). */
  similarity: number;
}

export interface SimilarCardsResponse {
  cardId: string;
  language: CardLanguage;
  sameArtwork: SimilarCard[];
  similarLook: SimilarCard[];
}

const clean = (value: string | null | undefined) => value?.trim().toLowerCase() || '';

function sameSubject(a: CardSubject, b: CardSubject) {
  if (a.dexIds.length || b.dexIds.length) return a.dexIds.some((id) => b.dexIds.includes(id));
  if (clean(a.name) && clean(b.name)) return clean(a.name) === clean(b.name);
  const pokemon = (card: CardSubject) => clean(card.category) === 'pokemon';
  if (pokemon(a) || pokemon(b) || clean(a.category) !== clean(b.category)) return false;
  return Boolean(clean(a.illustrator)) && clean(a.illustrator) === clean(b.illustrator);
}

/** True when a neighbour is another printing of the card's artwork (see SAME_ARTWORK_SIMILARITY). */
export function isSameArtwork(card: CardSubject, other: CardSubject, similarity: number) {
  if (!sameSubject(card, other)) return false;
  if (similarity >= SAME_ARTWORK_ANY_CREDIT) return true;
  const credits = [clean(card.illustrator), clean(other.illustrator)];
  return similarity >= SAME_ARTWORK_SIMILARITY && (!credits[0] || !credits[1] || credits[0] === credits[1]);
}

/**
 * Splits neighbours (most similar first) into the two groups. Each card id appears once, in its most similar
 * language, and never the card itself (its prints in other languages are the same card). Languages the app can't
 * show, and neighbours whose card isn't in `subjects`, are skipped. Similar look holds the nearest of the rest.
 */
export function splitSimilarNeighbours(
  cardId: string,
  neighbours: readonly SimilarNeighbour[],
  subjects: ReadonlyMap<string, CardSubject>,
  limits: { sameArtwork?: number; similarLook?: number } = {},
) {
  const card = subjects.get(cardId);
  const seen = new Set([cardId]);
  const sameArtwork: SplitNeighbour[] = [];
  const similarLook: SplitNeighbour[] = [];
  for (const neighbour of neighbours.toSorted((a, b) => b.similarity - a.similarity)) {
    const lang = neighbour.lang;
    const other = subjects.get(neighbour.cardId);
    if (seen.has(neighbour.cardId) || !other || !isCardLanguage(lang) || !Number.isFinite(neighbour.similarity))
      continue;
    seen.add(neighbour.cardId);
    const group = card && isSameArtwork(card, other, neighbour.similarity) ? sameArtwork : similarLook;
    group.push({ ...neighbour, lang });
  }
  return {
    sameArtwork: sameArtwork.slice(0, limits.sameArtwork ?? SAME_ARTWORK_LIMIT),
    similarLook: similarLook.slice(0, limits.similarLook ?? SIMILAR_LOOK_LIMIT),
  };
}

/** Reads `similar_tcg_cards` rows; malformed ones are dropped. */
export function normalizeSimilarNeighbours(rows: unknown): SimilarNeighbour[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const { card_id, lang, similarity } = row as Record<string, unknown>;
    const value = typeof similarity === 'string' ? Number(similarity) : similarity;
    return typeof card_id === 'string' &&
      typeof lang === 'string' &&
      typeof value === 'number' &&
      Number.isFinite(value)
      ? [{ cardId: card_id, lang, similarity: value }]
      : [];
  });
}

function isSimilarCard(value: unknown): value is SimilarCard {
  if (!value || typeof value !== 'object') return false;
  const card = value as Partial<SimilarCard>;
  return (
    typeof card.id === 'string' &&
    typeof card.name === 'string' &&
    typeof card.similarity === 'number' &&
    Array.isArray(card.dexIds) &&
    Boolean(card.set && typeof card.set.id === 'string')
  );
}

/** Validates the API response on the client. */
export function isSimilarCardsResponse(value: unknown): value is SimilarCardsResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<SimilarCardsResponse>;
  return (
    typeof response.cardId === 'string' &&
    Array.isArray(response.sameArtwork) &&
    Array.isArray(response.similarLook) &&
    response.sameArtwork.every(isSimilarCard) &&
    response.similarLook.every(isSimilarCard)
  );
}

/** The app's read (GET /app/api/tcg-similar-cards); null when it fails or the response isn't one. */
export async function loadSimilarCards(cardId: string, language: CardLanguage, signal?: AbortSignal) {
  const response = await fetch(
    `/app/api/tcg-similar-cards?cardId=${encodeURIComponent(cardId)}&language=${encodeURIComponent(language)}`,
    { signal },
  );
  const payload: unknown = response.ok ? await response.json() : null;
  return isSimilarCardsResponse(payload) ? payload : null;
}
