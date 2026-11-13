import { parseRawRestoreCommand, type RawRestoreCommand } from '@/lib/domain/raw-restore';
import { parseCollectionCreation, type CollectionCreationCommand } from '@/lib/domain/storage-creation';
import { normalizeAuditContext, type OperationIntentContext } from '@/lib/domain/audit-context';
import { parseSlotCommand, type SlotCommandRequest, type SlotPrecondition } from '@/lib/domain/slot-commands';
import {
  parseInventoryCommand,
  type InventoryCommand,
  type InventoryCommandRequest,
  type InventoryItemRef,
  type InventorySlotRef,
  INVENTORY_INSERT_LIMITS,
} from '@/lib/domain/inventory-commands';
import {
  normalizeInventorySnapshot,
  inventoryItemCandidate,
  type InventorySnapshot,
  type InventoryCatalogResolver,
} from '@/lib/domain/inventory';
import {
  planInsertSlots,
  planMoveSlots,
  planClearSlots,
  planRemoveSlots,
  planChangeSlotTarget,
} from '@/lib/binder-slot-plans';
import {
  planAssignInventory,
  planMoveInventory,
  planUnassignInventory,
  planEditInventoryMetadata,
  previewInventoryMoves,
} from '@/lib/inventory-plans';
import { isContractRecord, isSlotRevision, matchesSlotTarget } from '@/lib/domain/binder-slots';

export type SlotOfflineIntent =
  | { kind: 'creation'; request: CollectionCreationCommand; context: OperationIntentContext }
  | { kind: 'raw-restore'; request: RawRestoreCommand; context: OperationIntentContext }
  | { kind: 'slots'; request: SlotCommandRequest; context: OperationIntentContext }
  | { kind: 'inventory'; request: InventoryCommandRequest; context: OperationIntentContext };
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const slotIndex = (slots: readonly { id: string }[], id: string) => slots.findIndex((s) => s.id === id);
const findSlot = <T extends { id: string }>(slots: readonly T[], id: string): T | undefined =>
  slots[slotIndex(slots, id)];

function fail(reason: string): never {
  throw new Error(reason);
}
export function parseSlotIntent<K extends SlotOfflineIntent['kind']>(value: {
  kind: K;
  request: unknown;
  context: unknown;
}): Extract<SlotOfflineIntent, { kind: K }>;
export function parseSlotIntent(value: unknown): SlotOfflineIntent;
export function parseSlotIntent(value: unknown): SlotOfflineIntent {
  if (
    !isContractRecord(value, ['kind', 'request', 'context']) ||
    !isContractRecord(value.context, ['source', 'clientId', 'operationId', 'batchId', 'clientOccurredAt'])
  )
    return fail('invalid-intent');
  const context = normalizeAuditContext({
    ...value.context,
    actor: { kind: 'unknown' },
    affectedEntities: { inventoryItemIds: [], slotIds: [], collectionIds: [] },
  });
  if (!context) return fail('invalid-intent');
  const { actor: _actor, affectedEntities: _entities, ...intentContext } = context;
  const request =
    value.kind === 'slots'
      ? parseSlotCommand(value.request)
      : value.kind === 'inventory'
        ? parseInventoryCommand(value.request)
        : value.kind === 'creation'
          ? parseCollectionCreation(value.request)
          : value.kind === 'raw-restore'
            ? parseRawRestoreCommand(value.request)
            : fail('invalid-intent');
  if (request.operationId !== context.operationId) return fail('operation-id-mismatch');
  return { kind: value.kind, request, context: intentContext } as SlotOfflineIntent;
}
export function checkSlotRef(snapshot: InventorySnapshot, collectionId: string, ref: SlotPrecondition) {
  const slot = snapshot.binders.find((b) => b.collectionId === collectionId)?.slots.find((s) => s.id === ref.id);
  if (!slot || slot.version !== ref.version || slot.inventoryItemId !== ref.inventoryItemId)
    return fail('slot-conflict');
  const item = snapshot.items.find((i) => i.id === ref.inventoryItemId),
    placement = snapshot.placements.find((p) => p.inventoryItemId === ref.inventoryItemId);
  if (
    (item?.version ?? null) !== ref.itemVersion ||
    (placement?.version ?? null) !== ref.placementVersion ||
    (placement && (placement.collectionId !== collectionId || placement.slotId !== ref.id))
  )
    return fail('placement-conflict');
  return slot;
}

/** The copy's finish changes in place; a pocket that pins a finish must still match (SQL 114 rechecks). */
function projectSetFinish(
  state: InventorySnapshot,
  command: Extract<InventoryCommand, { kind: 'setFinish' }>,
  catalog: InventoryCatalogResolver,
): InventorySnapshot {
  const item = state.items.find((i) => i.id === command.item.itemId);
  if (!item || item.identity.kind !== 'card') return fail('invalid-command');
  if (item.identity.finish === command.finish) return state;
  const identity = { ...item.identity, finish: command.finish };
  const placement = command.item.placement;
  const slot = placement
    ? state.binders
        .find((b) => b.collectionId === placement.collectionId)
        ?.slots.find((s) => s.id === placement.slot.id)
    : undefined;
  const candidate = inventoryItemCandidate({ ...item, identity }, catalog);
  if (slot?.target && (!candidate || !matchesSlotTarget(candidate, slot.target))) return fail('target-mismatch');
  return {
    ...state,
    items: state.items.map((i) => (i.id === item.id ? { ...i, identity, version: i.version + 1 } : i)),
  };
}

/** Local preview only. Server predicates/ledger remain authoritative. No actor authority is persisted. */
export function projectSlotIntent(
  base: InventorySnapshot,
  raw: SlotOfflineIntent,
  catalog: InventoryCatalogResolver,
): InventorySnapshot {
  const intent = parseSlotIntent(raw);
  let state = normalizeInventorySnapshot(base) ?? fail('invalid-snapshot');
  // Pending creation is intent only. Never fabricate a usable collection or owned copies.
  if (intent.kind === 'creation' || intent.kind === 'raw-restore') return state;
  const original = structuredClone(state),
    touched = new Set<string>(),
    structural = new Set<string>();
  const { request } = intent;
  if (request.inventoryRevision !== state.inventoryRevision) return fail('inventory-conflict');
  const collections =
    intent.kind === 'slots'
      ? [
          {
            collectionId: intent.request.collectionId,
            version: intent.request.collectionVersion,
            layoutRevision: intent.request.layoutRevision,
          },
        ]
      : intent.request.collections;
  // Lookups read the current `state`, which commands below replace and mutate as they apply.
  const collectionOf = (collectionId: string) => state.collections.find((c) => c.id === collectionId);
  const findBinder = (collectionId: string) => state.binders.find((b) => b.collectionId === collectionId);
  const binderOf = (collectionId: string) => findBinder(collectionId)!;
  const slotAt = (collectionId: string, slotId: string) => binderOf(collectionId).slots.find((s) => s.id === slotId)!;
  const itemOf = (itemId: string | null) => state.items.find((i) => i.id === itemId);
  const placementOf = (itemId: string | null) => state.placements.find((p) => p.inventoryItemId === itemId);
  for (const ref of collections) {
    if (collectionOf(ref.collectionId)?.version !== ref.version) return fail('collection-conflict');
    if (findBinder(ref.collectionId)?.layoutRevision !== ref.layoutRevision) return fail('layout-conflict');
  }
  const context = {
    ...intent.context,
    actor: { kind: 'unknown' as const },
    affectedEntities: { inventoryItemIds: [], slotIds: [], collectionIds: [] },
  };
  const input = () => ({ inventoryRevision: state.inventoryRevision, context });
  const slotRevision = (ref: InventorySlotRef) => ({
    collectionId: ref.collectionId,
    slotId: ref.slot.id,
    slotVersion: ref.slot.version,
    layoutRevision: binderOf(ref.collectionId).layoutRevision,
  });
  const placedInput = (ref: InventoryItemRef) => {
    if (!ref.placement) return fail('placement-conflict');
    return {
      ...input(),
      inventoryItemId: ref.itemId,
      itemVersion: ref.itemVersion,
      placementVersion: ref.placement.slot.placementVersion!,
      source: slotRevision(ref.placement),
    };
  };
  const apply = (plan: ReturnType<typeof planAssignInventory>) => {
    if (!plan.ok) return fail(plan.error);
    state = plan.snapshot;
  };
  const checkItem = (ref: InventoryItemRef) => {
    if (original.items.find((i) => i.id === ref.itemId)?.version !== ref.itemVersion) return fail('item-conflict');
    const placement = original.placements.find((p) => p.inventoryItemId === ref.itemId);
    if (ref.placement) checkSlotRef(original, ref.placement.collectionId, ref.placement.slot);
    else if (placement) return fail('placement-conflict');
  };
  if (intent.kind === 'slots') {
    const id = intent.request.collectionId,
      used = new Set<string>();
    for (const command of intent.request.commands) {
      const binder = binderOf(id);
      // The grid isn't in the snapshot (read layouts carry it); pockets don't move, but SQL 118 always advances the layout.
      if (command.kind === 'layout') {
        touched.add(id);
        structural.add(id);
        continue;
      }
      const ids =
        command.kind === 'create'
          ? command.ids
          : (command.kind === 'update' ? [command.slot] : command.slots).map((s) => s.id);
      for (const slotId of ids) {
        if (used.has(slotId)) return fail('duplicate-slot');
        used.add(slotId);
      }
      if (command.kind !== 'create')
        for (const ref of command.kind === 'update' ? [command.slot] : command.slots) checkSlotRef(original, id, ref);
      let plan: ReturnType<typeof planMoveSlots>;
      if (command.kind === 'create') {
        plan = planInsertSlots(
          binder,
          binder.layoutRevision,
          command.ids.map((slotId) => ({
            id: slotId,
            ownerUserId: state.ownerUserId,
            collectionId: id,
            target: null,
            inventoryItemId: null,
            wantedCards: [],
            status: null,
            version: 0,
            presetOrigin: null,
          })),
          command.beforeSlotId,
        );
      } else if (command.kind === 'move')
        plan = planMoveSlots(
          binder,
          binder.layoutRevision,
          command.slots.map((s) => s.id),
          command.beforeSlotId,
        );
      else if (command.kind === 'clear' || command.kind === 'remove') {
        plan =
          command.kind === 'clear'
            ? planClearSlots(
                binder,
                binder.layoutRevision,
                command.slots.map((s) => s.id),
              )
            : planRemoveSlots(
                binder,
                binder.layoutRevision,
                command.slots.map((s) => s.id),
              );
      } else if (command.kind === 'update') {
        const slot = slotAt(id, command.slot.id);
        const item = itemOf(slot.inventoryItemId);
        plan =
          'target' in command
            ? planChangeSlotTarget(
                binder,
                binder.layoutRevision,
                slot.id,
                command.target!,
                item ? inventoryItemCandidate(item, catalog) : undefined,
              )
            : {
                ok: true,
                snapshot: structuredClone(binder),
                baseLayoutRevision: binder.layoutRevision,
                expectedSlotVersions: {},
                unassignedInventoryItemIds: [],
              };
        if (plan.ok && command.wantedCards) {
          const updated = findSlot(plan.snapshot.slots, slot.id)!;
          if (!sameValue(updated.wantedCards, command.wantedCards)) {
            updated.wantedCards = structuredClone(command.wantedCards);
            updated.version = slot.version + 1;
          }
        }
      } else return fail('invalid-command');
      if (!plan.ok) return fail(plan.error);
      if (!sameValue(binder, plan.snapshot)) touched.add(id);
      if (binder.layoutRevision !== plan.snapshot.layoutRevision) structural.add(id);
      state.binders = state.binders.map((b) => (b.collectionId === id ? plan.snapshot : b));
      const unassigned = new Set(plan.unassignedInventoryItemIds);
      state.placements = state.placements.filter((p) => !unassigned.has(p.inventoryItemId));
    }
  } else {
    const used = new Set<string>(),
      usedItems = new Set<string>(),
      insertedItems = new Set<string>();
    let insertionWork = 0;
    for (const c of intent.request.commands) {
      if (c.kind === 'patchGrading' || ('fulfillWant' in c && c.fulfillWant && 'expectedPublic' in c.fulfillWant))
        return fail('server-only-private-patch');
      const before = structuredClone(state);
      const item = 'item' in c ? c.item : undefined;
      if (item && insertedItems.has(item.itemId)) return fail('overlapping-command');
      const refs: InventorySlotRef[] = [];
      if (item) {
        checkItem(item);
        if (item.placement) refs.push(item.placement);
      }
      if ('destination' in c) refs.push(c.destination);
      if (c.kind === 'removeSlots') refs.push(...c.slots);
      if (c.kind === 'deleteCollection') refs.push(...c.slots.map((slot) => ({ collectionId: c.collectionId, slot })));
      for (const ref of refs) {
        checkSlotRef(original, ref.collectionId, ref.slot);
        if (used.has(ref.slot.id)) return fail('overlapping-command');
        used.add(ref.slot.id);
      }
      if (c.kind === 'insertAssign') {
        const binder = binderOf(c.collectionId);
        if (c.target?.kind === 'pokemon' && c.target.pokemonId > 1025) return fail('catalog-unavailable');
        if (c.target?.kind === 'card' && !catalog(c.target.cardId)) return fail('catalog-unavailable');
        if (c.before) {
          if (used.has(c.before.id)) return fail('overlapping-command');
          checkSlotRef(original, c.collectionId, c.before);
        }
        const slots = binder.slots,
          before = c.before;
        const index = before === null ? slots.length : slotIndex(slots, before.id);
        if (index < 0) return fail('slot-conflict');
        insertionWork += slots.length + 1;
        if (insertionWork > INVENTORY_INSERT_LIMITS.work || slots.length >= INVENTORY_INSERT_LIMITS.slots)
          return fail('slot-capacity-exceeded');
        if (used.has(c.slotId) || state.binders.some((b) => b.slots.some((s) => s.id === c.slotId)))
          return fail('slot-conflict');
        used.add(c.slotId);
        slots.splice(index, 0, {
          id: c.slotId,
          ownerUserId: state.ownerUserId,
          collectionId: c.collectionId,
          target: c.target,
          inventoryItemId: null,
          wantedCards: [],
          status: null,
          version: 0,
          presetOrigin: null,
        });
        if (c.selection !== null) {
          const selection = c.selection;
          const itemId = selection.kind === 'new' ? selection.itemId : selection.inventoryItemId;
          if (usedItems.has(itemId)) return fail('overlapping-command');
          usedItems.add(itemId);
          insertedItems.add(itemId);
          if (selection.kind === 'new') {
            const identity = selection.identity;
            if (identity.kind === 'pokemon' && identity.pokemonId > 1025) return fail('catalog-unavailable');
            if (state.items.some((i) => i.id === itemId)) return fail('item-conflict');
            const candidate = identity.kind === 'card' ? catalog(identity.cardId) : undefined;
            if (identity.kind === 'card' && !candidate) return fail('catalog-unavailable');
            state.items.push({
              id: itemId,
              ownerUserId: state.ownerUserId,
              identity:
                identity.kind === 'card' && candidate?.kind === 'card'
                  ? { ...identity, cardId: candidate.canonicalId ?? candidate.id }
                  : identity,
              grading: selection.grading,
              acquiredAt: selection.acquiredAt,
              version: 0,
            });
          }
          apply(
            planAssignInventory(
              state,
              {
                ...input(),
                destination: {
                  collectionId: c.collectionId,
                  slotId: c.slotId,
                  slotVersion: 0,
                  layoutRevision: binder.layoutRevision,
                },
                selection: {
                  kind: 'existing',
                  inventoryItemId: itemId,
                  itemVersion: selection.kind === 'new' ? 0 : selection.itemVersion,
                },
              },
              catalog,
            ),
          );
        }
        touched.add(c.collectionId);
        structural.add(c.collectionId);
      } else if (c.kind === 'add') {
        usedItems.add(c.itemId);
        if (state.items.some((i) => i.id === c.itemId)) return fail('item-conflict');
        state.items.push({
          id: c.itemId,
          ownerUserId: state.ownerUserId,
          identity: c.identity,
          grading: c.grading,
          acquiredAt: c.acquiredAt,
          version: 0,
        });
      } else if (c.kind === 'edit') {
        const { itemId, itemVersion } = c.item;
        apply(
          planEditInventoryMetadata(state, { ...input(), inventoryItemId: itemId, itemVersion, grading: c.grading }),
        );
      } else if (c.kind === 'setFinish') state = projectSetFinish(state, c, catalog);
      else if (c.kind === 'removeOwned' || c.kind === 'unassign') {
        const ref = c.item;
        if (ref.placement) apply(planUnassignInventory(state, placedInput(ref)));
        if (c.kind === 'removeOwned') state.items = state.items.filter((i) => i.id !== ref.itemId);
      } else if (c.kind === 'assign' || c.kind === 'move') {
        const destination = slotAt(c.destination.collectionId, c.destination.slot.id);
        const displacedId = destination.inventoryItemId;
        const displaced = itemOf(displacedId),
          placement = placementOf(displacedId);
        if (displacedId !== null && c.occupied === 'cancel') return fail('destination-occupied');
        if (c.kind === 'assign' && c.selection.kind === 'existing') {
          if (insertedItems.has(c.selection.inventoryItemId)) return fail('overlapping-command');
          usedItems.add(c.selection.inventoryItemId);
        }
        if (c.kind === 'assign')
          apply(
            planAssignInventory(
              state,
              { ...input(), destination: slotRevision(c.destination), selection: c.selection },
              catalog,
            ),
          );
        else {
          const move = { ...placedInput(c.item), destination: slotRevision(c.destination), occupied: c.occupied };
          const preview = previewInventoryMoves(state, { ...input(), moves: [move] }, catalog);
          if (!preview.ok) return fail(preview.error);
          apply(planMoveInventory(state, move, catalog));
          if (c.occupied === 'swap' && displaced && placement) {
            const source = slotAt(c.item.placement!.collectionId, c.item.placement!.slot.id);
            apply(
              planAssignInventory(
                state,
                {
                  ...input(),
                  selection: { kind: 'existing', inventoryItemId: displaced.id, itemVersion: displaced.version },
                  destination: {
                    collectionId: source.collectionId,
                    slotId: source.id,
                    slotVersion: source.version,
                    layoutRevision: binderOf(source.collectionId).layoutRevision,
                  },
                },
                catalog,
              ),
            );
            // SQL versions each swapped slot once, including the cleared source.
            slotAt(source.collectionId, source.id).version = source.version;
            placementOf(displaced.id)!.version = placement.version + 1;
          }
        }
        if (c.fulfillWant) {
          if (!('expected' in c.fulfillWant)) return fail('server-only-private-patch');
          const slot = slotAt(c.destination.collectionId, c.destination.slot.id);
          if (!sameValue(slot.wantedCards[c.fulfillWant.index], c.fulfillWant.expected)) return fail('wanted-conflict');
          const assigned = itemOf(slot.inventoryItemId)!;
          const candidate = inventoryItemCandidate(assigned, catalog),
            want = c.fulfillWant.expected;
          if (
            !candidate ||
            !matchesSlotTarget(candidate, {
              kind: 'card',
              cardId: want.card_id,
              ...(want.card_language ? { language: want.card_language } : {}),
              ...(want.card_finish ? { finish: want.card_finish } : {}),
            })
          )
            return fail('wanted-conflict');
          slot.wantedCards.splice(c.fulfillWant.index, 1);
        }
      } else {
        const ids = new Set(refs.map((r) => r.slot.id));
        if (c.kind === 'deleteCollection' && binderOf(c.collectionId).slots.length !== ids.size)
          return fail('partial-collection');
        state.placements = state.placements.filter((p) => !ids.has(p.slotId));
        state.binders = state.binders.map((b) => {
          if (!b.slots.some((s) => ids.has(s.id))) return b;
          structural.add(b.collectionId);
          return { ...b, slots: b.slots.filter((s) => !ids.has(s.id)) };
        });
        if (c.kind === 'deleteCollection') {
          if (c.removeOwned) {
            const placed = new Set(refs.map((r) => r.slot.inventoryItemId));
            state.items = state.items.filter((i) => !placed.has(i.id) || i.grading !== null);
          }
          state.collections = state.collections.filter((col) => col.id !== c.collectionId);
          state.binders = state.binders.filter((b) => b.collectionId !== c.collectionId);
          touched.add(c.collectionId);
          if (c.replacementDefaultCollectionId) touched.add(c.replacementDefaultCollectionId);
        }
      }
      if ('item' in c) usedItems.add(c.item.itemId);
      for (const ref of refs) if (ref.slot.inventoryItemId !== null) usedItems.add(ref.slot.inventoryItemId);
      if (!sameValue(before, state)) for (const ref of refs) touched.add(ref.collectionId);
    }
  }
  if (structural.size || !sameValue(original, state)) {
    state.inventoryRevision = original.inventoryRevision + 1;
    state.collections = state.collections.map((c) => ({
      ...c,
      version: original.collections.find((b) => b.id === c.id)!.version + (touched.has(c.id) ? 1 : 0),
    }));
    state.binders = state.binders.map((b) => ({
      ...b,
      layoutRevision:
        original.binders.find((a) => a.collectionId === b.collectionId)!.layoutRevision +
        (structural.has(b.collectionId) ? 1 : 0),
    }));
  }
  if (!isSlotRevision(state.inventoryRevision) || state.collections.some((c) => !isSlotRevision(c.version)))
    return fail('revision-overflow');
  return normalizeInventorySnapshot(state) ?? fail('invalid-projection');
}
