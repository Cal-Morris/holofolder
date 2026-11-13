import type { InventorySnapshot } from '@/lib/domain/inventory';

/** What a card on the page (or a candidate) is compared on. */
export type SuggestionTraits = { id: string; setId: string; illustrator?: string; types: string[]; dexIds: number[] };

/** Points per page card a candidate shares something with, so a page's dominant theme wins. */
const WEIGHTS = { pokemon: 4, illustrator: 3, type: 1, set: 1 };

/**
 * The page a free pocket is on, as suggestion seeds: card ids and Pokémon on that page, plus every card already in the
 * binder (never suggested again).
 */
export function pageSuggestionSeeds(
  snapshot: InventorySnapshot,
  collectionId: string,
  slotId: string,
  perPage: number,
) {
  const slots = snapshot.binders.find((b) => b.collectionId === collectionId)?.slots ?? [];
  const at = slots.findIndex((s) => s.id === slotId);
  if (at < 0 || perPage < 1) return null;
  const items = new Map(snapshot.items.map((item) => [item.id, item]));
  const cardOf = (slot: (typeof slots)[number]) => {
    const identity = slot.inventoryItemId ? items.get(slot.inventoryItemId)?.identity : undefined;
    if (identity) return identity.kind === 'card' ? { cardId: identity.cardId } : { pokemonId: identity.pokemonId };
    if (slot.target)
      return slot.target.kind === 'card' ? { cardId: slot.target.cardId } : { pokemonId: slot.target.pokemonId };
    return {};
  };
  const first = at - (at % perPage);
  const page = slots.slice(first, first + perPage).map(cardOf);
  const cardIds = [...new Set(page.flatMap((c) => (c.cardId ? [c.cardId] : [])))].toSorted();
  const pokemonIds = [...new Set(page.flatMap((c) => (c.pokemonId ? [c.pokemonId] : [])))].toSorted((a, b) => a - b);
  if (!cardIds.length && !pokemonIds.length) return null;
  return { cardIds, pokemonIds, binderCardIds: slots.flatMap((s) => cardOf(s).cardId ?? []) };
}

/** Candidates ranked by what they share with the page's cards (and Pokémon-only pockets). Seeds themselves are left out. */
export function rankPageSuggestions<T extends SuggestionTraits>(
  seeds: readonly SuggestionTraits[],
  pokemonIds: readonly number[],
  candidates: readonly T[],
  limit = 60,
): T[] {
  const seedIds = new Set(seeds.map((s) => s.id));
  const unique = new Map<string, T>();
  for (const c of candidates) if (!seedIds.has(c.id)) unique.set(c.id, c);
  const scored = [...unique.values()].map((card) => {
    const dexIds = new Set(card.dexIds),
      types = new Set(card.types);
    let score = pokemonIds.filter((id) => dexIds.has(id)).length * WEIGHTS.pokemon;
    for (const seed of seeds) {
      if (seed.dexIds.some((id) => dexIds.has(id))) score += WEIGHTS.pokemon;
      if (seed.illustrator && seed.illustrator === card.illustrator) score += WEIGHTS.illustrator;
      if (seed.types.some((type) => types.has(type))) score += WEIGHTS.type;
      if (seed.setId === card.setId) score += WEIGHTS.set;
    }
    return { card, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id))
    .slice(0, limit)
    .map((s) => s.card);
}

/**
 * Picture neighbour lists (one per page card) as card ids, most similar first: a card's similarities add up across the
 * lists, so one that looks like several page cards beats one that looks like a single card. Page cards are left out.
 */
export function rankVisualSuggestions(
  lists: ReadonlyArray<ReadonlyArray<{ cardId: string; similarity: number }>>,
  pageCardIds: readonly string[],
): string[] {
  const page = new Set(pageCardIds);
  const scores = new Map<string, number>();
  for (const list of lists)
    for (const { cardId, similarity } of list)
      if (!page.has(cardId)) scores.set(cardId, (scores.get(cardId) ?? 0) + similarity);
  return [...scores].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}
