// Collection import on native storage, planned like Show mode's Bought (lib/collection/show-bought.ts): pure planning,
// and the intents go through the device queue like every other binder edit. Each raw card fills the open binder's empty
// pocket made for it (filling a matching want), else gets a new pocket at the end. A second copy of a card the binder
// already holds, and every graded copy, is added to the collection without a pocket.
import type { CardFinish, CardLanguage } from '@/lib/domain/cards';
import type { InventoryCommand } from '@/lib/domain/inventory-commands';
import type { GradingRecord, InventoryCatalogResolver, InventorySnapshot } from '@/lib/domain/inventory';
import type { OperationIntentContext } from '@/lib/domain/audit-context';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import { matchesSlotTarget } from '@/lib/domain/binder-slots';
import { matchesCatalogCardId } from '@/lib/card-catalog';
import { pickerCandidate } from '@/lib/slot-picker';
import { parseSlotIntent, projectSlotIntent, type SlotOfflineIntent } from '@/lib/collection/slot-optimistic';

export interface ImportCopy {
  card: SearchCardResult;
  language: CardLanguage;
  finish: CardFinish;
  grading: GradingRecord | null;
}
export interface ImportPlan {
  intents: Extract<SlotOfflineIntent, { kind: 'inventory' }>[];
  filled: number;
  appended: number;
  unplaced: number;
}
/** Well inside the 100-command, 256-entity and 256 KiB request limits. */
const BATCH = 50;

export function importCatalog(copies: readonly ImportCopy[], fallback?: InventoryCatalogResolver) {
  return ((id: string) => {
    const copy = copies.find((c) => matchesCatalogCardId(c.card, id));
    return copy ? { ...pickerCandidate(copy.card), finish: copy.finish } : fallback?.(id);
  }) as InventoryCatalogResolver;
}

export function planImport({
  snapshot,
  collectionId,
  copies,
  context,
  catalog,
  newId = () => crypto.randomUUID(),
}: {
  snapshot: InventorySnapshot;
  collectionId: string;
  copies: readonly ImportCopy[];
  context: () => OperationIntentContext;
  catalog?: InventoryCatalogResolver;
  newId?: () => string;
}): ImportPlan {
  const resolve = importCatalog(copies, catalog);
  const plan: ImportPlan = { intents: [], filled: 0, appended: 0, unplaced: 0 };
  let state = snapshot;
  for (let start = 0; start < copies.length; start += BATCH) {
    const binders = new Map(state.binders.map((b) => [b.collectionId, b]));
    const collections = new Map(state.collections.map((c) => [c.id, c]));
    const binder = binders.get(collectionId);
    const collection = collections.get(collectionId);
    if (!binder || !collection) throw new Error('The binder changed. Reopen Import and try again.');
    const cardOf = new Map(
      state.items.flatMap((i) => (i.identity.kind === 'card' ? [[i.id, i.identity.cardId] as const] : [])),
    );
    const placedCards = new Set<string>();
    for (const p of state.placements) {
      const cardId = p.collectionId === collectionId ? cardOf.get(p.inventoryItemId) : undefined;
      if (cardId) placedCards.add(cardId);
    }
    const taken = new Set<string>();
    const commands: InventoryCommand[] = [];
    for (const copy of copies.slice(start, start + BATCH)) {
      const { card, language, finish, grading } = copy;
      const cardId = card.canonicalId ?? card.id;
      const itemId = newId();
      const identity = { kind: 'card' as const, cardId, language, finish };
      if (grading || placedCards.has(cardId)) {
        commands.push({ kind: 'add', itemId, identity, grading, acquiredAt: null });
        plan.unplaced++;
        continue;
      }
      placedCards.add(cardId);
      const candidate = { ...pickerCandidate(card), finish };
      let slot: (typeof binder.slots)[number] | undefined;
      let want = -1;
      for (const s of binder.slots) {
        if (
          s.inventoryItemId !== null ||
          s.target === null ||
          taken.has(s.id) ||
          !matchesSlotTarget(candidate, s.target)
        )
          continue;
        // oxlint-disable-next-line react-doctor/js-index-maps -- a pocket lists at most 100 wants
        const index = s.wantedCards.findIndex(
          (w) => w.card_id === cardId && w.card_language === language && w.card_finish === finish,
        );
        if (index >= 0) {
          slot = s;
          want = index;
          break;
        }
        slot ??= s;
      }
      if (!slot) {
        commands.push({
          kind: 'insertAssign',
          collectionId,
          slotId: newId(),
          before: null,
          target: identity,
          selection: { kind: 'new', itemId, identity, grading: null, acquiredAt: null },
        });
        plan.appended++;
        continue;
      }
      taken.add(slot.id);
      commands.push({
        kind: 'assign',
        selection: { kind: 'catalog', identity, newItemId: itemId },
        destination: {
          collectionId,
          slot: {
            id: slot.id,
            version: slot.version,
            inventoryItemId: null,
            itemVersion: null,
            placementVersion: null,
          },
        },
        occupied: 'cancel',
        fulfillWant: want >= 0 ? { index: want, expected: structuredClone(slot.wantedCards[want]) } : null,
      });
      plan.filled++;
    }
    const ctx = context();
    const intent = parseSlotIntent({
      kind: 'inventory',
      context: ctx,
      request: {
        operationId: ctx.operationId,
        inventoryRevision: state.inventoryRevision,
        collections: [{ collectionId, version: collection.version, layoutRevision: binder.layoutRevision }],
        commands,
      },
    });
    plan.intents.push(intent);
    // The next batch is planned on this one's result, as the queue will apply them in order.
    state = projectSlotIntent(state, intent, resolve);
  }
  return plan;
}
