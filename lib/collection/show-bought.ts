// Show mode's Bought, on native storage: each card bought becomes one new owned copy. A copy goes into the empty
// pocket that wanted that exact printing (filling the want), otherwise it is added unassigned. Pure planning only:
// the intents go through the same device queue as every other native edit, so this works offline.
import type { CardFinish, CardLanguage, WantedCard } from '@/lib/domain/cards';
import type { InventoryCommand } from '@/lib/domain/inventory-commands';
import type { InventoryLayoutEvidence } from '@/lib/domain/inventory-browse';
import type { InventorySnapshot } from '@/lib/domain/inventory';
import type { SlotPrecondition } from '@/lib/domain/slot-commands';
import type { OperationIntentContext } from '@/lib/domain/audit-context';
import { parseSlotIntent, projectSlotIntent, type SlotOfflineIntent } from '@/lib/collection/slot-optimistic';
import { pocketPlace } from '@/lib/pocket-labels';

export interface BoughtCard {
  cardId: string;
  /** Unknown stays unknown: the copy is recorded without a language rather than a guessed one. */
  language?: CardLanguage;
  finish?: CardFinish;
}

export type BoughtPlacement =
  | {
      kind: 'placed';
      itemId: string;
      collectionId: string;
      slotId: string;
      /** The pocket's wants before the copy filled one, so Undo can put the want back. */
      wantedBefore: WantedCard[];
      label: string;
    }
  | { kind: 'unassigned'; itemId: string; label: string };

const emptySlotRef = (slot: { id: string; version: number }): SlotPrecondition => ({
  id: slot.id,
  version: slot.version,
  inventoryItemId: null,
  itemVersion: null,
  placementVersion: null,
});

/**
 * The empty pocket wanting exactly this printing (card, language and finish), in binder then pocket order, skipping
 * pockets already chosen. A pocket holding any copy is never chosen; a want with an unknown language or finish only
 * matches a card bought with the same unknown.
 */
export function findWantedPocket(
  snapshot: InventorySnapshot,
  card: BoughtCard,
  taken: ReadonlySet<string> = new Set(),
): { collectionId: string; slotIndex: number; wantedIndex: number } | null {
  for (const binder of snapshot.binders) {
    for (const [slotIndex, slot] of binder.slots.entries()) {
      if (slot.inventoryItemId !== null || taken.has(slot.id)) continue;
      for (const [wantedIndex, want] of slot.wantedCards.entries())
        if (
          want.card_id === card.cardId &&
          (want.card_language ?? undefined) === card.language &&
          (want.card_finish ?? undefined) === card.finish
        )
          return { collectionId: binder.collectionId, slotIndex, wantedIndex };
    }
  }
  return null;
}

/** One inventory intent (one activity entry) adding every bought card, placed where wanted. */
export function planBought({
  snapshot,
  layouts,
  cards,
  context,
  newId = () => crypto.randomUUID(),
  now = new Date(),
}: {
  snapshot: InventorySnapshot;
  layouts: readonly InventoryLayoutEvidence[];
  cards: readonly BoughtCard[];
  context: OperationIntentContext;
  newId?: () => string;
  now?: Date;
}): { intent: Extract<SlotOfflineIntent, { kind: 'inventory' }>; placements: BoughtPlacement[] } {
  const taken = new Set<string>();
  const commands: InventoryCommand[] = [];
  const placements: BoughtPlacement[] = [];
  const touched = new Set<string>();
  const binders = new Map(snapshot.binders.map((b) => [b.collectionId, b]));
  const collections = new Map(snapshot.collections.map((c) => [c.id, c]));
  const grids = new Map(layouts.map((l) => [`${l.collectionId}:${l.layoutRevision}`, l]));
  for (const card of cards) {
    const itemId = newId();
    const identity = {
      kind: 'card' as const,
      cardId: card.cardId,
      ...(card.language ? { language: card.language } : {}),
      ...(card.finish ? { finish: card.finish } : {}),
    };
    const pocket = findWantedPocket(snapshot, card, taken);
    if (!pocket) {
      commands.push({ kind: 'add', itemId, identity, grading: null, acquiredAt: now.toISOString() });
      placements.push({ kind: 'unassigned', itemId, label: 'your inventory' });
      continue;
    }
    const binder = binders.get(pocket.collectionId)!;
    const slot = binder.slots[pocket.slotIndex];
    taken.add(slot.id);
    touched.add(binder.collectionId);
    commands.push({
      kind: 'assign',
      selection: { kind: 'catalog', identity, newItemId: itemId },
      destination: { collectionId: binder.collectionId, slot: emptySlotRef(slot) },
      occupied: 'cancel',
      fulfillWant: { index: pocket.wantedIndex, expected: structuredClone(slot.wantedCards[pocket.wantedIndex]) },
    });
    const layout = grids.get(`${binder.collectionId}:${binder.layoutRevision}`);
    const place = layout ? pocketPlace(pocket.slotIndex, layout.rows, layout.cols) : `Pocket ${pocket.slotIndex + 1}`;
    const name = collections.get(binder.collectionId)?.name;
    placements.push({
      kind: 'placed',
      itemId,
      collectionId: binder.collectionId,
      slotId: slot.id,
      wantedBefore: structuredClone(slot.wantedCards),
      label: binders.size > 1 && name ? `${name} · ${place}` : place,
    });
  }
  const intent = parseSlotIntent({
    kind: 'inventory',
    context,
    request: {
      operationId: context.operationId,
      inventoryRevision: snapshot.inventoryRevision,
      collections: [...touched].map((collectionId) => ({
        collectionId,
        version: collections.get(collectionId)!.version,
        layoutRevision: binders.get(collectionId)!.layoutRevision,
      })),
      commands,
    },
  });
  return { intent, placements };
}

/**
 * Undo, planned on the snapshot after the Bought edit (it may still be queued): remove each new copy, then put the
 * filled wants back in their pockets (a linked pair of intents, planned on the projected result of the first).
 * Copies changed since (moved, removed) are left alone.
 */
export function planBoughtUndo({
  snapshot,
  placements,
  context,
  restoreContext,
}: {
  snapshot: InventorySnapshot;
  placements: readonly BoughtPlacement[];
  context: OperationIntentContext;
  /** Builds the context (with its own operation ID) for each want-restoring intent. */
  restoreContext: () => OperationIntentContext;
}): SlotOfflineIntent[] {
  const commands: InventoryCommand[] = [];
  const touched = new Set<string>();
  const restores: Extract<BoughtPlacement, { kind: 'placed' }>[] = [];
  const items = new Map(snapshot.items.map((i) => [i.id, i]));
  const placedAt = new Map(snapshot.placements.map((p) => [p.inventoryItemId, p]));
  const slots = new Map(snapshot.binders.flatMap((b) => b.slots.map((s) => [s.id, s] as const)));
  const binders = new Map(snapshot.binders.map((b) => [b.collectionId, b]));
  const collections = new Map(snapshot.collections.map((c) => [c.id, c]));
  for (const placement of placements) {
    const item = items.get(placement.itemId);
    if (!item) continue;
    const at = placedAt.get(item.id);
    if (placement.kind === 'unassigned') {
      if (!at)
        commands.push({ kind: 'removeOwned', item: { itemId: item.id, itemVersion: item.version, placement: null } });
      continue;
    }
    const slot = slots.get(placement.slotId);
    if (!at || !slot || at.collectionId !== placement.collectionId || at.slotId !== placement.slotId) continue;
    touched.add(placement.collectionId);
    commands.push({
      kind: 'removeOwned',
      item: {
        itemId: item.id,
        itemVersion: item.version,
        placement: {
          collectionId: placement.collectionId,
          slot: {
            id: slot.id,
            version: slot.version,
            inventoryItemId: item.id,
            itemVersion: item.version,
            placementVersion: at.version,
          },
        },
      },
    });
    restores.push(placement);
  }
  if (!commands.length) return [];
  const removal = parseSlotIntent({
    kind: 'inventory',
    context,
    request: {
      operationId: context.operationId,
      inventoryRevision: snapshot.inventoryRevision,
      collections: [...touched].map((collectionId) => ({
        collectionId,
        version: collections.get(collectionId)!.version,
        layoutRevision: binders.get(collectionId)!.layoutRevision,
      })),
      commands,
    },
  });
  const after = projectSlotIntent(snapshot, removal, () => undefined);
  const byCollection = Map.groupBy(restores, (r) => r.collectionId);
  const restoring = [...byCollection].flatMap(([collectionId, pockets]) => {
    const binder = after.binders.find((b) => b.collectionId === collectionId)!;
    const slotsAfter = new Map(binder.slots.map((s) => [s.id, s]));
    const updates = pockets.flatMap((pocket) => {
      const slot = slotsAfter.get(pocket.slotId);
      // Only an empty pocket gets its wants back; one filled again since keeps what it has.
      return slot && slot.inventoryItemId === null
        ? [{ kind: 'update' as const, slot: emptySlotRef(slot), wantedCards: structuredClone(pocket.wantedBefore) }]
        : [];
    });
    if (!updates.length) return [];
    const restoreCtx = restoreContext();
    return [
      parseSlotIntent({
        kind: 'slots',
        context: restoreCtx,
        request: {
          operationId: restoreCtx.operationId,
          inventoryRevision: after.inventoryRevision,
          collectionId,
          collectionVersion: after.collections.find((c) => c.id === collectionId)!.version,
          layoutRevision: binder.layoutRevision,
          commands: updates,
        },
      }),
    ];
  });
  return [removal, ...restoring];
}
