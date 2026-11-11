import { indexCatalogCardIds } from '@/lib/card-catalog';
import type { CardFinish, WantedCard } from '@/lib/domain/cards';
import type { InventorySnapshot, Placement } from '@/lib/domain/inventory';
import type { InventoryCatalogEvidence } from '@/lib/domain/inventory-browse';
import {
  getCardPriceKey,
  type CardPriceLookup,
  type CardPriceSnapshot,
  type PricedCardFinish,
} from '@/lib/card-pricing';
import { applyPriceStaleness } from '@/lib/price-freshness';
import { getRegionalFinishPrices } from '@/lib/regional-price';
import type { PricingRegion } from '@/lib/pricing-region';

export interface InventoryPriceIdentity extends CardPriceLookup {
  finish: CardFinish;
}
export interface InventoryOwnedProjection {
  itemId: string;
  placement: Placement | null;
  /** Null is unknown catalog association; [] is an attested non-Pokémon card. */
  pokemonIds: readonly number[] | null;
  priceIdentity: InventoryPriceIdentity | null;
  graded: boolean;
  acquiredAt: string | null;
}
export interface InventoryWantProjection {
  collectionId: string;
  slotId: string;
  index: number;
  card: WantedCard;
}
export interface InventoryCollectionProjection {
  owned: InventoryOwnedProjection[];
  wants: InventoryWantProjection[];
  speciesIds: number[];
  unknownSpeciesCopies: number;
  priceIdentities: InventoryPriceIdentity[];
  /** Saved-price transport returns every finish in one card/language snapshot. */
  priceRequests: CardPriceLookup[];
}

/** Validated owner-scoped snapshots only. No species-keyed compatibility map or mutation destinations. */
export function projectInventoryCollection(
  snapshot: InventorySnapshot,
  catalog: readonly InventoryCatalogEvidence[],
  collectionId?: string,
  catalogById: ReadonlyMap<string, readonly InventoryCatalogEvidence[]> = indexCatalogCardIds(catalog),
): InventoryCollectionProjection {
  const placements = new Map(snapshot.placements.map((p) => [p.inventoryItemId, p]));
  const seen = new Set<string>();
  const owned: InventoryOwnedProjection[] = [];
  for (const item of snapshot.items) {
    const placement = placements.get(item.id) ?? null;
    if (
      item.ownerUserId !== snapshot.ownerUserId ||
      seen.has(item.id) ||
      (collectionId && placement?.collectionId !== collectionId)
    )
      continue;
    seen.add(item.id);
    const identity = item.identity;
    const matches =
      identity.kind === 'card'
        ? (catalogById.get(identity.cardId) ?? []).filter(
            (e) => !identity.language || e.card.language === identity.language,
          )
        : [];
    const card = matches.length === 1 ? matches[0] : undefined;
    owned.push({
      itemId: item.id,
      placement,
      graded: item.grading !== null,
      acquiredAt: item.acquiredAt,
      pokemonIds: identity.kind === 'pokemon' ? [identity.pokemonId] : (card?.pokemonIds ?? null),
      priceIdentity:
        identity.kind === 'card' && identity.language && identity.finish && card
          ? { cardId: card.card.canonicalId ?? card.card.id, language: identity.language, finish: identity.finish }
          : null,
    });
  }
  const wants = snapshot.binders
    .filter((b) => !collectionId || b.collectionId === collectionId)
    .flatMap((b) =>
      b.slots.flatMap((s) =>
        s.wantedCards.map((card, index) => ({ collectionId: b.collectionId, slotId: s.id, index, card })),
      ),
    );
  return summarizeInventoryProjection(owned, wants);
}

/** Storage scope does not deduplicate repeated wanted destinations or include Unassigned. */
export function selectInventoryCollection(projection: InventoryCollectionProjection, collectionId?: string) {
  return summarizeInventoryProjection(
    projection.owned.filter((i) => !collectionId || i.placement?.collectionId === collectionId),
    projection.wants.filter((w) => !collectionId || w.collectionId === collectionId),
  );
}

function summarizeInventoryProjection(
  owned: InventoryOwnedProjection[],
  wants: InventoryWantProjection[],
): InventoryCollectionProjection {
  const priceIdentities = [
    ...new Map(
      owned.flatMap((i) => (i.priceIdentity ? [[JSON.stringify(i.priceIdentity), i.priceIdentity] as const] : [])),
    ).values(),
  ];
  const priceRequests = [
    ...new Map(
      priceIdentities.map(({ cardId, language }) => [getCardPriceKey(cardId, language), { cardId, language }]),
    ).values(),
  ];
  return {
    owned,
    wants,
    priceIdentities,
    priceRequests,
    speciesIds: [...new Set(owned.flatMap((i) => i.pokemonIds ?? []))].sort((a, b) => a - b),
    unknownSpeciesCopies: owned.filter((i) => i.pokemonIds === null).length,
  };
}

/** Saved standard raw quotes only. Exact finish required; no headline fallback or grade multiplier. */
export function valueInventoryCollection(
  projection: InventoryCollectionProjection,
  prices: readonly CardPriceSnapshot[],
  region: PricingRegion,
  now = Date.now(),
) {
  const saved = new Map(prices.map((p) => [getCardPriceKey(p.cardId, p.language), p]));
  const quotes = new Map(
    projection.priceIdentities.map((identity) => {
      const snapshot = saved.get(getCardPriceKey(identity.cardId, identity.language));
      const finish = getRegionalFinishPrices(snapshot ? applyPriceStaleness(snapshot, now) : undefined, region)[
        identity.finish as PricedCardFinish
      ];
      const amount = finish?.gbpAmount;
      // This read surface never introduces timing signals, including for low/unknown confidence.
      const quote =
        finish && typeof amount === 'number' && Number.isFinite(amount) && amount > 0
          ? { ...finish, ...applyPriceStaleness(finish, now), buySignal: null }
          : null;
      return [JSON.stringify(identity), quote] as const;
    }),
  );
  const copies = projection.owned.map((item) => {
    const quote = item.priceIdentity ? (quotes.get(JSON.stringify(item.priceIdentity)) ?? null) : null;
    return {
      itemId: item.itemId,
      basis: item.graded ? ('raw-reference' as const) : ('raw' as const),
      amountGbp: item.graded ? null : (quote?.gbpAmount ?? null),
      referenceGbp: quote?.gbpAmount ?? null,
      quote,
    };
  });
  return {
    copies,
    rawTotalGbp: Math.round(copies.reduce((sum, c) => sum + (c.amountGbp ?? 0), 0) * 100) / 100,
    rawPricedCopies: copies.filter((c) => c.amountGbp !== null).length,
    rawUnknownCopies: copies.filter((c) => c.basis === 'raw' && c.amountGbp === null).length,
    gradedUnknownCopies: copies.filter((c) => c.basis === 'raw-reference').length,
  };
}
