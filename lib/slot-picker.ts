import type { SlotCommandSink, StagedSlotCommandIntent } from '@/lib/binder-slot-editing';
import type { OperationIntentContext } from '@/lib/domain/audit-context';
import { isCardLanguage, type CardFinish, type TCGCard, type WantedCard } from '@/lib/domain/cards';
import type { SlotTarget } from '@/lib/domain/binder-slots';
import {
  inventoryItemCandidate,
  type InventoryCatalogResolver,
  type InventoryIdentity,
  type InventorySnapshot,
} from '@/lib/domain/inventory';
import type { InventorySelection } from '@/lib/inventory-plans';
import type { SelectedWant } from '@/lib/domain/inventory-commands';
import { matchesSlotTarget } from '@/lib/domain/binder-slots';
import { parseSlotIntent, projectSlotIntent } from '@/lib/collection/slot-optimistic';
import { getCardPickerFinishChoices } from '@/lib/card-picker-filters';
import { inferCardFinish } from '@/lib/pokemon-card-browse';
import { isStandardFinishVariantKey, type CardFinishPrice } from '@/lib/card-pricing';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import type { InventoryCatalogEvidence } from '@/lib/domain/inventory-browse';
import { matchesCatalogCardId } from '@/lib/card-catalog';

export interface SlotPickerScope {
  ownerUserId: string;
  collectionId: string;
  slotId: string;
}
/** What a pocket needs to save a card: the current read, its exact scope and the native durable sink. */
export interface SlotPickerBoundary {
  snapshot: InventorySnapshot;
  scope: SlotPickerScope;
  catalog: InventoryCatalogResolver;
  onCommandIntent: SlotCommandSink;
  localDurable?: boolean;
}
export interface SlotPickerIntent extends StagedSlotCommandIntent {
  scope: SlotPickerScope;
}
export type SlotPickerAction =
  | { kind: 'assign'; selection: InventorySelection; fulfillWant: SelectedWant }
  | { kind: 'target'; target: SlotTarget | null }
  | { kind: 'clear' };

export function pickerCandidate(card: SearchCardResult) {
  return {
    kind: 'card' as const,
    id: card.id,
    canonicalId: card.canonicalId,
    aliasIds: card.aliasIds,
    pokemonIds: Array.isArray(card.dexIds) ? card.dexIds.filter((id) => Number.isSafeInteger(id) && id > 0) : [],
    ...(isCardLanguage(card.language) ? { language: card.language } : {}),
  };
}

/** Group by the complete recorded grade, but expose only provider/grade, never certificates or labels. */
export function pickerChoices(
  snapshot: InventorySnapshot,
  identity: Extract<InventoryIdentity, { kind: 'card' }>,
  catalog: InventoryCatalogResolver,
): { label: string; selection: InventorySelection }[] {
  const evidence = catalog(identity.cardId);
  if (!evidence) return [];
  const groups = new Map<string, { label: string; selection: InventorySelection }>();
  for (const item of [...snapshot.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (
      item.identity.kind !== 'card' ||
      item.identity.language !== identity.language ||
      item.identity.finish !== identity.finish ||
      snapshot.placements.some((p) => p.inventoryItemId === item.id)
    )
      continue;
    const candidate = inventoryItemCandidate(item, catalog);
    if (!candidate || !matchesSlotTarget(candidate, { kind: 'card', cardId: evidence.canonicalId ?? evidence.id }))
      continue;
    const key = JSON.stringify(item.grading);
    if (groups.has(key)) continue;
    const grade = item.grading;
    groups.set(key, {
      label: grade
        ? `${grade.provider.kind === 'known' ? grade.provider.id.toUpperCase() : grade.provider.name} ${grade.grade ?? 'Unknown grade'}`
        : 'Raw',
      selection: { kind: 'existing', inventoryItemId: item.id, itemVersion: item.version },
    });
  }
  return [...groups.values()].sort((a, b) =>
    a.label === 'Raw' ? -1 : b.label === 'Raw' ? 1 : a.label.localeCompare(b.label),
  );
}

/** Parsed draft plus canonical local projection. No durable acceptance, authentication, reservation or ACK. */
export function prepareSlotPickerIntent(
  snapshot: InventorySnapshot,
  scope: SlotPickerScope,
  action: SlotPickerAction,
  context: OperationIntentContext,
  catalog: InventoryCatalogResolver,
) {
  const binder = snapshot.binders.find((b) => b.collectionId === scope.collectionId);
  const collection = snapshot.collections.find((c) => c.id === scope.collectionId);
  const slot = binder?.slots.find((s) => s.id === scope.slotId);
  if (
    snapshot.ownerUserId !== scope.ownerUserId ||
    !binder ||
    !collection ||
    !slot ||
    slot.ownerUserId !== scope.ownerUserId
  )
    throw new Error('picker-scope-changed');
  const item = snapshot.items.find((i) => i.id === slot.inventoryItemId);
  const placement = snapshot.placements.find((p) => p.inventoryItemId === slot.inventoryItemId);
  const ref = {
    id: slot.id,
    version: slot.version,
    inventoryItemId: slot.inventoryItemId,
    itemVersion: item?.version ?? null,
    placementVersion: placement?.version ?? null,
  };
  const common = { operationId: context.operationId, inventoryRevision: snapshot.inventoryRevision };
  const intent = parseSlotIntent(
    action.kind === 'assign'
      ? {
          kind: 'inventory',
          context,
          request: {
            ...common,
            collections: [
              { collectionId: collection.id, version: collection.version, layoutRevision: binder.layoutRevision },
            ],
            commands: [
              {
                kind: 'assign',
                selection: action.selection,
                destination: { collectionId: collection.id, slot: ref },
                occupied: 'cancel',
                fulfillWant: action.fulfillWant,
              },
            ],
          },
        }
      : {
          kind: 'slots',
          context,
          request: {
            ...common,
            collectionId: collection.id,
            collectionVersion: collection.version,
            layoutRevision: binder.layoutRevision,
            commands: [
              action.kind === 'clear'
                ? { kind: 'clear', slots: [ref] }
                : { kind: 'update', slot: ref, target: action.target },
            ],
          },
        },
  );
  return { scope: { ...scope }, intent, preview: projectSlotIntent(snapshot, intent, catalog) };
}

/** Existing catalog/provider finish rules, retaining absence when neither source knows. */
export function pickerFinishes(
  card: SearchCardResult,
  quotes: readonly Pick<CardFinishPrice, 'finish' | 'variantKey' | 'gbpAmount'>[] = [],
) {
  const inferred = inferCardFinish(card.rarity, card.variants);
  const choices = getCardPickerFinishChoices(card.variants, inferred, 'any', quotes);
  if (choices.length) return choices;
  if (inferred !== 'normal' && inferred !== 'holo') return [{ finish: inferred, label: inferred.replaceAll('_', ' ') }];
  if (card.variants?.normal) return [{ finish: 'normal' as const, label: 'Normal' }];
  if (card.variants?.holo) return [{ finish: 'holo' as const, label: 'Holo' }];
  if (card.variants?.reverse) return [{ finish: 'reverse_holo' as const, label: 'Reverse' }];
  const quote = quotes.find(
    (q) => isStandardFinishVariantKey(q.variantKey) && Number.isFinite(q.gbpAmount) && (q.gbpAmount ?? 0) > 0,
  );
  return quote ? [{ finish: quote.finish, label: quote.finish.replaceAll('_', ' ') }] : [];
}

/**
 * A species card-selector pick as picker input. The list is joined on this dex id, so it is the one species
 * link the evidence states; nothing else (other dex ids, finish, grading) is added.
 */
export function speciesSelectorCard(card: TCGCard, pokemonId: number): SearchCardResult {
  return { ...card, dexIds: [pokemonId] };
}

/** Indexes of the slot's own wants this exact printing, language and finish could fulfil. Never fulfils anything by itself. */
export function matchingWantIndexes(
  wants: readonly WantedCard[],
  card: SearchCardResult,
  finish: CardFinish | undefined,
): number[] {
  const candidate = { ...pickerCandidate(card), ...(finish ? { finish } : {}) };
  return wants.flatMap((want, index) =>
    matchesSlotTarget(candidate, {
      kind: 'card',
      cardId: want.card_id,
      ...(want.card_language ? { language: want.card_language } : {}),
      ...(want.card_finish ? { finish: want.card_finish } : {}),
    })
      ? [index]
      : [],
  );
}

/**
 * What one card pick (from the card selector or catalog search) needs before it can be saved. `immediate` is the
 * selection to save at once; it is null only when an owned graded copy or one of the slot's own wants makes the
 * copy or want an explicit choice. A pick never fulfils a want or picks a graded copy by itself.
 */
export function planNativePick(
  snapshot: InventorySnapshot,
  scope: SlotPickerScope,
  card: SearchCardResult,
  finish: CardFinish | undefined,
  catalog: InventoryCatalogResolver,
  newItemId: string,
) {
  const slot = snapshot.binders
    .find((b) => b.collectionId === scope.collectionId)
    ?.slots.find((s) => s.id === scope.slotId);
  if (!slot || snapshot.ownerUserId !== scope.ownerUserId) throw new Error('picker-scope-changed');
  const candidate = pickerCandidate(card);
  const resolver: InventoryCatalogResolver = (id) => (matchesCatalogCardId(card, id) ? candidate : catalog(id));
  const options = pickerFinishes(card);
  const settled = finish ?? (options.length === 1 ? options[0].finish : undefined);
  const identity = {
    kind: 'card' as const,
    cardId: card.canonicalId ?? card.id,
    ...(isCardLanguage(card.language) ? { language: card.language } : {}),
    ...(settled ? { finish: settled } : {}),
  };
  const copies = pickerChoices(snapshot, identity, resolver);
  const wants = slot.inventoryItemId ? [] : matchingWantIndexes(slot.wantedCards, card, settled);
  const fresh: InventorySelection = { kind: 'catalog', identity, newItemId };
  const raw = copies.find((c) => c.label === 'Raw')?.selection;
  const base = raw ?? fresh;
  const graded = copies.some((c) => c.label !== 'Raw');
  // A graded choice always offers a new copy when no unplaced raw copy exists, so a graded copy is never forced.
  const choices = graded ? (raw ? copies : [{ label: 'New copy', selection: fresh }, ...copies]) : [];
  // The card exactly as the picker showed it, so the pocket keeps its name and artwork until a read includes it.
  const picked: InventoryCatalogEvidence = {
    card: { ...card, language: isCardLanguage(card.language) ? card.language : undefined },
    speciesNames: [],
    pokemonIds: candidate.pokemonIds,
  };
  return {
    resolver,
    identity,
    base,
    choices,
    picked,
    immediate: wants.length || graded ? null : base,
    wants: wants.map((index) => ({ index, name: slot.wantedCards[index].card_name })),
    wanted: (index: number): SelectedWant => ({ index, expected: slot.wantedCards[index] }),
  };
}
export type NativePickPlan = ReturnType<typeof planNativePick>;
