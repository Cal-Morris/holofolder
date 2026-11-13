import {
  navigationIndex,
  type CollectionNavigationRead,
  type CollectionNavigationScope,
} from '@/lib/collection-navigation';
import { selectInventoryCollection } from '@/lib/collection/inventory-projection';
import { browserHostCatalog, browserHostDisplayCatalog } from '@/lib/collection/browser-host-catalog';
import { matchesCatalogCardId } from '@/lib/card-catalog';
import { isCardLanguage, type CardFinish, type CollectedPokemon, type WantedCard } from '@/lib/domain/cards';
import { getPokemonSummary } from '@/lib/pokemon-catalog';
import type { PublicWantedCard } from '@/lib/domain/inventory-commands';
import type { BrowseCard, SearchCardResult } from '@/lib/pokemon-card-browse';
import { prepareSlotPickerIntent } from '@/lib/slot-picker';
import type { InventorySelection } from '@/lib/inventory-plans';
import type { OperationIntentContext } from '@/lib/domain/audit-context';
import type { SlotCommandSink } from '@/lib/binder-slot-editing';
import type { HuntSourceItem } from '@/lib/show-hunt';

export interface NativeWantedDestination {
  scope: CollectionNavigationScope;
  collectionId: string;
  slotId: string;
  wantedIndex: number;
  inventoryRevision: number;
  collectionVersion: number;
  layoutRevision: number;
  slotVersion: number;
  expectedPublic: PublicWantedCard;
}
export interface NativeConsumerBinding {
  scope: CollectionNavigationScope;
  read: CollectionNavigationRead;
  /** Undefined means All storage, including Unassigned. */
  collectionId?: string;
  /** Open this exact printing for lookup, never derive a species destination. */
  /** `finish` is the exact finish to show (a want's own finish); without it the card's usual finish is shown. */
  openCard: (card: SearchCardResult, finish?: CardFinish) => void;
  editingAvailable: boolean;
  /** Host rechecks live lifecycle, online state, pending intents and recovery. Null denies editing. */
  admit: () => {
    scope: CollectionNavigationScope;
    read: CollectionNavigationRead;
    context: OperationIntentContext;
    receive: SlotCommandSink;
  } | null;
}

function publicWant(card: WantedCard): PublicWantedCard {
  const { wanted_by: _actor, card_image: _image, ...expected } = card;
  return structuredClone(expected);
}

/** Presentation shares Inventory's distinct-copy/Unassigned accounting. Targets never produce wants. */
export function nativeCardConsumers(binding: Pick<NativeConsumerBinding, 'scope' | 'read' | 'collectionId'>) {
  const { scope, read, collectionId } = binding;
  const index = navigationIndex(scope, read);
  if (
    !index.projection ||
    read.evidence.kind === 'unavailable' ||
    (collectionId && !index.collections.some((c) => c.id === collectionId))
  )
    return null;
  const snapshot = read.evidence.snapshot;
  const projection = selectInventoryCollection(index.projection, collectionId);
  const display = browserHostDisplayCatalog(read.catalog);
  const wants = projection.wants.map((want) => {
    const binder = snapshot.binders.find((b) => b.collectionId === want.collectionId)!;
    const slot = binder.slots.find((s) => s.id === want.slotId)!;
    const collection = snapshot.collections.find((c) => c.id === want.collectionId)!;
    // Missing language is unknown, never inferred as English for an exact destination.
    const card = want.card.card_language ? display(want.card.card_id, want.card.card_language) : undefined;
    const species = card ? read.catalog.find((c) => c.card === card)?.pokemonIds : undefined;
    const destination: NativeWantedDestination = {
      scope: { ...scope },
      collectionId: want.collectionId,
      slotId: want.slotId,
      wantedIndex: want.index,
      inventoryRevision: snapshot.inventoryRevision,
      collectionVersion: collection.version,
      layoutRevision: binder.layoutRevision,
      slotVersion: slot.version,
      expectedPublic: publicWant(want.card),
    };
    return {
      key: JSON.stringify([want.collectionId, want.slotId, want.index]),
      destination,
      collectionName: collection.name,
      want: want.card,
      card: card ? { ...card, dexIds: species ? [...species] : [] } : null,
      finish: want.card.card_finish ?? null,
      occupied: slot.inventoryItemId !== null,
    };
  });
  const allCopies = index.projection.owned.map((copy) => {
    const item = snapshot.items.find((i) => i.id === copy.itemId)!;
    const identity = item.identity;
    const card =
      identity.kind === 'card' && identity.language ? display(identity.cardId, identity.language) : undefined;
    return {
      itemId: copy.itemId,
      itemVersion: item.version,
      unassigned: copy.placement === null,
      card: card ?? null,
      finish: identity.kind === 'card' ? (identity.finish ?? null) : null,
    };
  });
  const scopedIds = new Set(projection.owned.map((c) => c.itemId));
  return {
    kind: index.kind,
    projection,
    copies: allCopies.filter((c) => scopedIds.has(c.itemId)),
    availableCopies: allCopies.filter((c) => c.unassigned),
    wants,
  };
}

/** A printing badge counts copies and explicit entries, even when both Owned and Wanted are true. */
export function nativeCardState(model: ReturnType<typeof nativeCardConsumers>, card: BrowseCard, finish?: CardFinish) {
  const owned =
    model?.copies.filter(
      (copy) =>
        copy.card &&
        matchesCatalogCardId(card, copy.card.canonicalId ?? copy.card.id) &&
        copy.card.language === card.language &&
        (!finish || copy.finish === finish),
    ) ?? [];
  const wants =
    model?.wants.filter(
      (w) =>
        w.card &&
        matchesCatalogCardId(card, w.card.canonicalId ?? w.card.id) &&
        w.card.language === card.language &&
        (!finish || w.finish === finish),
    ) ?? [];
  return {
    known: model !== null,
    owned: owned.length > 0,
    wanted: wants.length > 0,
    ownedCount: owned.length,
    wantedCount: wants.length,
  };
}
/** The one finish saved for this exact printing (copies and wants), for a card whose rarity is unknown. */
export function nativeSavedFinish(model: ReturnType<typeof nativeCardConsumers>, card: BrowseCard) {
  const finishes = new Set(
    [...(model?.copies ?? []), ...(model?.wants ?? [])].flatMap((entry) =>
      entry.card &&
      matchesCatalogCardId(card, entry.card.canonicalId ?? entry.card.id) &&
      entry.card.language === card.language
        ? [entry.finish]
        : [],
    ),
  );
  const [finish] = finishes;
  return finishes.size === 1 && finish ? finish : undefined;
}
export function nativeCardLabel(state: ReturnType<typeof nativeCardState>) {
  if (!state.known) return 'Ownership unavailable';
  return (
    [state.ownedCount ? `Owned ×${state.ownedCount}` : '', state.wantedCount ? `Wanted ×${state.wantedCount}` : '']
      .filter(Boolean)
      .join(' · ') || 'No exact saved match'
  );
}

/** Every recorded copy remains a separate choice. No private grade/certificate or automatic Raw reuse. */
export function nativeWantSelections(
  model: ReturnType<typeof nativeCardConsumers>,
  destination: NativeWantedDestination,
) {
  const want = model?.wants.find((w) => JSON.stringify(w.destination) === JSON.stringify(destination));
  if (!want?.card || !want.finish || !isCardLanguage(want.card.language)) return [];
  const copies = model!.availableCopies.filter(
    (copy) =>
      copy.card &&
      matchesCatalogCardId(want.card!, copy.card.canonicalId ?? copy.card.id) &&
      copy.card.language === want.card!.language &&
      copy.finish === want.finish,
  );
  return copies.map((copy) => ({
    selection: { kind: 'existing' as const, inventoryItemId: copy.itemId, itemVersion: copy.itemVersion },
  }));
}

/** Re-resolve exact evidence at click time. This is draft preparation, never authority or server success. */
export function prepareNativeWant(
  binding: NativeConsumerBinding,
  destination: NativeWantedDestination,
  selection: InventorySelection,
) {
  const admission = binding.editingAvailable ? binding.admit() : null;
  if (!admission || JSON.stringify(admission.scope) !== JSON.stringify(destination.scope))
    throw new Error('Native editing unavailable or session changed');
  const current = { ...binding, scope: admission.scope, read: admission.read };
  const model = nativeCardConsumers(current);
  if (model?.kind !== 'complete' || admission.read.evidence.kind !== 'complete')
    throw new Error('A complete current read is required');
  const want = model.wants.find((w) => JSON.stringify(w.destination) === JSON.stringify(destination));
  if (!want?.card || !want.finish || want.occupied)
    throw new Error('Destination changed, occupied or exact printing unknown');
  const choices = nativeWantSelections(model, destination);
  if (
    selection.kind === 'existing'
      ? !choices.some((c) => JSON.stringify(c.selection) === JSON.stringify(selection))
      : choices.length > 0 ||
        selection.identity.cardId !== (want.card.canonicalId ?? want.card.id) ||
        selection.identity.language !== want.card.language ||
        selection.identity.finish !== want.finish
  )
    throw new Error('Choose an exact copy');
  // First-party complete reads retain the exact want. The optimistic command sink rejects
  // expectedPublic, so never reconstruct hidden fields from a public/lookup projection.
  const expected = admission.read.evidence.snapshot.binders
    .find((b) => b.collectionId === destination.collectionId)!
    .slots.find((s) => s.id === destination.slotId)!.wantedCards[destination.wantedIndex];
  const prepared = prepareSlotPickerIntent(
    admission.read.evidence.snapshot,
    { ownerUserId: admission.scope.ownerUserId, collectionId: destination.collectionId, slotId: destination.slotId },
    { kind: 'assign', selection, fulfillWant: { index: destination.wantedIndex, expected: structuredClone(expected) } },
    admission.context,
    browserHostCatalog(admission.read.catalog),
  );
  return { ...prepared, receive: admission.receive };
}

/**
 * Read-only species view of the native read for Browse, Sets and the National Dex list. Each copy is
 * its own row (Sets counts every printing held); species rows merge copies and explicit wants. Slot
 * targets are neither owned nor wanted. Copies with no species (Trainer/Energy) appear only in rows.
 */
export function nativeSpeciesCollection(binding: Pick<NativeConsumerBinding, 'scope' | 'read' | 'collectionId'>) {
  const model = nativeCardConsumers(binding);
  if (!model || binding.read.evidence.kind === 'unavailable') return null;
  const items = new Map(binding.read.evidence.snapshot.items.map((i) => [i.id, i]));
  const cards = new Map(model.copies.map((c) => [c.itemId, c]));
  const name = (id: number) => getPokemonSummary(id)?.name ?? `#${id}`;
  const rows: CollectedPokemon[] = [];
  const bySpecies = new Map<number, CollectedPokemon>();
  for (const copy of model.projection.owned) {
    const identity = items.get(copy.itemId)!.identity;
    const card = cards.get(copy.itemId)?.card;
    const species = copy.pokemonIds ?? [];
    const row: CollectedPokemon = {
      id: copy.itemId,
      pokemon_id: species[0] ?? 0,
      pokemon_name: species.length ? name(species[0]) : '',
      wanted_cards: [],
      status: 'collected',
      collected_at: copy.acquiredAt ?? '',
      ...(identity.kind === 'card'
        ? {
            card_id: identity.cardId,
            card_language: identity.language,
            card_finish: identity.finish,
            card_name: card?.name,
            card_image: card?.image,
            card_set: card?.set.name,
          }
        : {}),
    };
    rows.push(row);
    for (const id of species)
      if (!bySpecies.has(id)) bySpecies.set(id, { ...row, pokemon_id: id, pokemon_name: name(id) });
  }
  // model.wants is built 1:1 from projection.wants; the projection keeps the exact WantedCard.
  model.projection.wants.forEach((want, i) => {
    for (const id of model.wants[i].card?.dexIds ?? []) {
      const item = bySpecies.get(id) ?? {
        id: `want:${id}`,
        pokemon_id: id,
        pokemon_name: name(id),
        wanted_cards: [],
        status: 'wishlisted' as const,
        collected_at: '',
      };
      bySpecies.set(id, { ...item, wanted_cards: [...item.wanted_cards, want.card] });
    }
    // Every explicit want, with or without a species, marks its printing in the Sets checklist.
    rows.push({
      id: `want:${want.collectionId}:${want.slotId}:${want.index}`,
      pokemon_id: 0,
      pokemon_name: '',
      wanted_cards: [want.card],
      status: 'wishlisted',
      collected_at: '',
    });
  });
  return { bySpecies, rows };
}

/** Pokémon id of the Hunting group for wanted printings with no species (Trainers, Energy). */
export const NO_SPECIES_HUNT_ID = 0;

/**
 * Show mode's Hunting list source from the native read: one item per species with its explicit wants, plus
 * one item for wants with no species. Never invents species-only "any card" wants: native has none.
 */
export function nativeHuntItems(
  binding: Pick<NativeConsumerBinding, 'scope' | 'read' | 'collectionId'>,
): HuntSourceItem[] | null {
  const model = nativeCardConsumers(binding);
  if (!model) return null;
  const items = new Map<number, HuntSourceItem & { wanted_cards: WantedCard[] }>();
  for (const want of model.wants) {
    const ids = want.card?.dexIds.length ? want.card.dexIds : [NO_SPECIES_HUNT_ID];
    for (const id of ids) {
      const item = items.get(id) ?? {
        pokemon_id: id,
        pokemon_name: id === NO_SPECIES_HUNT_ID ? 'Trainers & Energy' : (getPokemonSummary(id)?.name ?? `#${id}`),
        status: 'wishlisted',
        wanted_cards: [],
      };
      item.wanted_cards.push(want.want);
      items.set(id, item);
    }
  }
  return [...items.values()];
}
