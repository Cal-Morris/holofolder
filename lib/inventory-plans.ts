import { normalizeAuditContext, type AuditContext } from '@/lib/domain/audit-context';
import { matchesSlotTarget, isSlotContractId, isSlotRevision, type BinderSlot } from '@/lib/domain/binder-slots';
import {
  inventoryItemCandidate,
  normalizeGradingRecord,
  normalizeInventoryIdentity,
  normalizeInventorySnapshot,
  type InventorySnapshot,
  type InventoryIdentity,
  type InventoryItem,
  type GradingRecord,
  type InventoryCatalogResolver,
} from '@/lib/domain/inventory';

export interface InventorySlotRevision {
  collectionId: string;
  slotId: string;
  layoutRevision: number;
  slotVersion: number;
}
export interface InventoryPlanInput {
  inventoryRevision: number;
  context: AuditContext;
}
export type InventorySelection =
  | { kind: 'catalog'; identity: Extract<InventoryIdentity, { kind: 'card' }>; newItemId: string }
  | { kind: 'existing'; inventoryItemId: string; itemVersion: number };
export interface AssignInventoryInput extends InventoryPlanInput {
  destination: InventorySlotRevision;
  selection: InventorySelection;
}
export interface PlacedInventoryInput extends InventoryPlanInput {
  inventoryItemId: string;
  itemVersion: number;
  placementVersion: number;
  source: InventorySlotRevision;
}
export type InventoryPlanError =
  | 'invalid-snapshot'
  | 'invalid-context'
  | 'invalid-selection'
  | 'inventory-conflict'
  | 'item-conflict'
  | 'placement-conflict'
  | 'layout-conflict'
  | 'slot-conflict'
  | 'invalid-destination'
  | 'target-mismatch'
  | 'catalog-unavailable'
  | 'copy-choice-required'
  | 'revision-overflow'
  | 'invalid-grading';
export interface InventoryPreconditions {
  inventoryRevision: number;
  items: Record<string, number | null>;
  placements: Record<string, number | null>;
  slots: Record<string, number>;
  layouts: Record<string, number>;
  collections: Record<string, number>;
}
export type InventoryPlan =
  | { ok: false; error: InventoryPlanError }
  | {
      ok: true;
      snapshot: InventorySnapshot;
      selectedInventoryItemId: string | null;
      preconditions: InventoryPreconditions;
      context: AuditContext;
      changed: boolean;
    };
type Prepared = Extract<InventoryPlan, { ok: true }>;
const fail = (error: InventoryPlanError): Extract<InventoryPlan, { ok: false }> => ({ ok: false, error });
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function prepare(snapshot: InventorySnapshot, input: InventoryPlanInput): InventoryPlan {
  const copy = normalizeInventorySnapshot(snapshot);
  if (!copy) return fail('invalid-snapshot');
  if (!isSlotRevision(input.inventoryRevision) || copy.inventoryRevision !== input.inventoryRevision)
    return fail('inventory-conflict');
  const context = normalizeAuditContext(input.context);
  if (!context) return fail('invalid-context');
  context.affectedEntities = { inventoryItemIds: [], slotIds: [], collectionIds: [] };
  return {
    ok: true,
    snapshot: copy,
    selectedInventoryItemId: null,
    preconditions: {
      inventoryRevision: copy.inventoryRevision,
      items: {},
      placements: {},
      slots: {},
      layouts: {},
      collections: {},
    },
    context,
    changed: false,
  };
}

function selectSlot(plan: Prepared, ref: InventorySlotRevision): BinderSlot | InventoryPlanError {
  const collection = plan.snapshot.collections.find((c) => c.id === ref.collectionId);
  const binder = plan.snapshot.binders.find((b) => b.collectionId === ref.collectionId);
  const slot = binder?.slots.find((s) => s.id === ref.slotId);
  if (!collection || !binder || !slot) return 'invalid-destination';
  if (!isSlotRevision(ref.layoutRevision) || binder.layoutRevision !== ref.layoutRevision) return 'layout-conflict';
  if (!isSlotRevision(ref.slotVersion) || slot.version !== ref.slotVersion) return 'slot-conflict';
  plan.preconditions.layouts = { ...plan.preconditions.layouts, [binder.collectionId]: binder.layoutRevision };
  plan.preconditions.collections = { ...plan.preconditions.collections, [collection.id]: collection.version };
  plan.preconditions.slots = { ...plan.preconditions.slots, [slot.id]: slot.version };
  return slot;
}
function expectItem(plan: Prepared, item: InventoryItem) {
  plan.preconditions.items = { ...plan.preconditions.items, [item.id]: item.version };
  const placement = plan.snapshot.placements.find((p) => p.inventoryItemId === item.id);
  plan.preconditions.placements = { ...plan.preconditions.placements, [item.id]: placement?.version ?? null };
}
function setSlotItem(plan: Prepared, slot: BinderSlot, itemId: string | null): boolean {
  if (slot.inventoryItemId === itemId) return true;
  if (slot.version === Number.MAX_SAFE_INTEGER) return false;
  if (slot.inventoryItemId !== null) {
    const displaced = plan.snapshot.items.find((i) => i.id === slot.inventoryItemId)!;
    expectItem(plan, displaced);
    plan.snapshot.placements = plan.snapshot.placements.filter((p) => p.inventoryItemId !== displaced.id);
    plan.context.affectedEntities.inventoryItemIds.push(displaced.id);
  }
  slot.inventoryItemId = itemId;
  slot.status = itemId === null ? null : 'collected';
  slot.version++;
  plan.context.affectedEntities.slotIds.push(slot.id);
  plan.context.affectedEntities.collectionIds.push(slot.collectionId);
  plan.changed = true;
  return true;
}
function finish(plan: Prepared): InventoryPlan {
  if (plan.changed) {
    if (plan.snapshot.inventoryRevision === Number.MAX_SAFE_INTEGER) return fail('revision-overflow');
    plan.snapshot.inventoryRevision++;
  }
  for (const key of ['inventoryItemIds', 'slotIds', 'collectionIds'] as const) {
    plan.context.affectedEntities[key] = [...new Set(plan.context.affectedEntities[key])].sort();
  }
  return plan;
}

/** Catalog selection never moves placed items. Explicit existing selection must still be Unassigned. */
export function planAssignInventory(
  snapshot: InventorySnapshot,
  input: AssignInventoryInput,
  resolveCatalog: InventoryCatalogResolver,
): InventoryPlan {
  const plan = prepare(snapshot, input);
  if (!plan.ok) return plan;
  const destination = selectSlot(plan, input.destination);
  if (typeof destination === 'string') return fail(destination);
  let item: InventoryItem;
  const selection = input.selection;
  if (selection.kind === 'existing') {
    const selected = plan.snapshot.items.find((i) => i.id === selection.inventoryItemId);
    if (!selected || !isSlotRevision(selection.itemVersion) || selected.version !== selection.itemVersion)
      return fail('item-conflict');
    if (plan.snapshot.placements.some((p) => p.inventoryItemId === selected.id)) return fail('placement-conflict');
    item = selected;
  } else if (selection.kind === 'catalog') {
    const identity = normalizeInventoryIdentity(selection.identity);
    if (!identity || identity.kind !== 'card' || !isSlotContractId(selection.newItemId))
      return fail('invalid-selection');
    const probe: InventoryItem = {
      id: selection.newItemId,
      ownerUserId: snapshot.ownerUserId,
      identity,
      grading: null,
      acquiredAt: null,
      version: 0,
    };
    const candidate = inventoryItemCandidate(probe, resolveCatalog);
    if (!candidate || candidate.kind !== 'card') return fail('catalog-unavailable');
    const eligible = plan.snapshot.items
      .filter((i) => {
        if (
          i.identity.kind !== 'card' ||
          i.identity.language !== identity.language ||
          i.identity.finish !== identity.finish ||
          plan.snapshot.placements.some((p) => p.inventoryItemId === i.id)
        )
          return false;
        const existing = inventoryItemCandidate(i, resolveCatalog);
        return (
          existing !== undefined &&
          matchesSlotTarget(existing, { kind: 'card', cardId: candidate.canonicalId ?? candidate.id })
        );
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (new Set(eligible.map((i) => JSON.stringify(i.grading))).size > 1) return fail('copy-choice-required');
    if (eligible.length) item = eligible[0];
    else {
      if (plan.snapshot.items.some((i) => i.id === probe.id)) return fail('item-conflict');
      item = { ...probe, identity: { ...identity, cardId: candidate.canonicalId ?? candidate.id } };
      plan.preconditions.items = { ...plan.preconditions.items, [item.id]: null };
      plan.snapshot.items.push(item);
    }
  } else return fail('invalid-selection');
  if (destination.target !== null) {
    const candidate = inventoryItemCandidate(item, resolveCatalog);
    if (!candidate) return fail('catalog-unavailable');
    if (!matchesSlotTarget(candidate, destination.target)) return fail('target-mismatch');
  }
  if (!Object.hasOwn(plan.preconditions.items, item.id)) expectItem(plan, item);
  else plan.preconditions.placements = { ...plan.preconditions.placements, [item.id]: null };
  if (!setSlotItem(plan, destination, item.id)) return fail('revision-overflow');
  plan.snapshot.placements.push({
    inventoryItemId: item.id,
    collectionId: destination.collectionId,
    slotId: destination.id,
    version: 0,
  });
  plan.selectedInventoryItemId = item.id;
  plan.context.affectedEntities.inventoryItemIds.push(item.id);
  return finish(plan);
}

function selectPlaced(
  plan: Prepared,
  input: PlacedInventoryInput,
): { item: InventoryItem; source: BinderSlot; placementVersion: number } | InventoryPlanError {
  const item = plan.snapshot.items.find((i) => i.id === input.inventoryItemId);
  if (!item || !isSlotRevision(input.itemVersion) || item.version !== input.itemVersion) return 'item-conflict';
  const placement = plan.snapshot.placements.find((p) => p.inventoryItemId === item.id);
  if (
    !placement ||
    !isSlotRevision(input.placementVersion) ||
    placement.version !== input.placementVersion ||
    placement.collectionId !== input.source.collectionId ||
    placement.slotId !== input.source.slotId
  )
    return 'placement-conflict';
  const source = selectSlot(plan, input.source);
  if (typeof source === 'string') return source;
  expectItem(plan, item);
  plan.selectedInventoryItemId = item.id;
  return { item, source, placementVersion: placement.version };
}

/** Moves contents only; target/order/wants/provenance remain at both stable slots. */
export function planMoveInventory(
  snapshot: InventorySnapshot,
  input: PlacedInventoryInput & { destination: InventorySlotRevision },
  resolveCatalog: InventoryCatalogResolver,
): InventoryPlan {
  const plan = prepare(snapshot, input);
  if (!plan.ok) return plan;
  const selected = selectPlaced(plan, input);
  if (typeof selected === 'string') return fail(selected);
  const destination = selectSlot(plan, input.destination);
  if (typeof destination === 'string') return fail(destination);
  if (destination.id === selected.source.id) return finish(plan);
  if (destination.target !== null) {
    const candidate = inventoryItemCandidate(selected.item, resolveCatalog);
    if (!candidate) return fail('catalog-unavailable');
    if (!matchesSlotTarget(candidate, destination.target)) return fail('target-mismatch');
  }
  if (
    selected.placementVersion === Number.MAX_SAFE_INTEGER ||
    !setSlotItem(plan, selected.source, null) ||
    !setSlotItem(plan, destination, selected.item.id)
  )
    return fail('revision-overflow');
  plan.snapshot.placements.push({
    inventoryItemId: selected.item.id,
    collectionId: destination.collectionId,
    slotId: destination.id,
    version: selected.placementVersion + 1,
  });
  return finish(plan);
}

export function planUnassignInventory(snapshot: InventorySnapshot, input: PlacedInventoryInput): InventoryPlan {
  const plan = prepare(snapshot, input);
  if (!plan.ok) return plan;
  const selected = selectPlaced(plan, input);
  if (typeof selected === 'string') return fail(selected);
  if (!setSlotItem(plan, selected.source, null)) return fail('revision-overflow');
  return finish(plan);
}

/** Compose with #360 clear/remove, or collection deletion, in one future transaction. Never deletes an item. */
export function planReleaseInventorySlots(
  snapshot: InventorySnapshot,
  input: InventoryPlanInput & { collectionId: string; layoutRevision: number; slotVersions: Record<string, number> },
): InventoryPlan {
  const plan = prepare(snapshot, input);
  if (!plan.ok) return plan;
  const entries = Object.entries(input.slotVersions);
  if (!entries.length) return fail('invalid-selection');
  for (const [slotId, slotVersion] of entries) {
    const slot = selectSlot(plan, {
      collectionId: input.collectionId,
      layoutRevision: input.layoutRevision,
      slotId,
      slotVersion,
    });
    if (typeof slot === 'string') return fail(slot);
    if (!setSlotItem(plan, slot, null)) return fail('revision-overflow');
  }
  return finish(plan);
}

/** Metadata edits cannot change an item's physical identity. Replacement uses assignment instead. */
export function planEditInventoryMetadata(
  snapshot: InventorySnapshot,
  input: InventoryPlanInput & { inventoryItemId: string; itemVersion: number; grading: GradingRecord | null },
): InventoryPlan {
  const plan = prepare(snapshot, input);
  if (!plan.ok) return plan;
  const item = plan.snapshot.items.find((i) => i.id === input.inventoryItemId);
  if (!item || !isSlotRevision(input.itemVersion) || item.version !== input.itemVersion) return fail('item-conflict');
  const grading = normalizeGradingRecord(input.grading);
  if (grading === undefined || (grading !== null && item.identity.kind === 'pokemon')) return fail('invalid-grading');
  expectItem(plan, item);
  plan.selectedInventoryItemId = item.id;
  if (!equal(item.grading, grading)) {
    if (item.version === Number.MAX_SAFE_INTEGER) return fail('revision-overflow');
    item.grading = grading;
    item.version++;
    plan.changed = true;
    plan.context.affectedEntities.inventoryItemIds.push(item.id);
  }
  return finish(plan);
}

export type InventoryMovePreviewInput = Omit<PlacedInventoryInput, keyof InventoryPlanInput> & {
  destination: InventorySlotRevision;
  occupied: 'cancel' | 'unassign' | 'swap';
};
export type InventoryMovePreview =
  | { ok: false; error: InventoryPlanError | 'destination-occupied' | 'invalid-batch' }
  | {
      ok: true;
      pairings: {
        inventoryItemId: string;
        sourceSlotId: string;
        destinationSlotId: string;
        displacedInventoryItemId: string | null;
        occupied: InventoryMovePreviewInput['occupied'];
      }[];
    };

/** Read-only pairing preview using the accepted match/version plans. No ownership or auth proof.
 * Caller supplies selected IDs, never an automatic species/printing-to-slot pairing. SQL rechecks all predicates. */
export function previewInventoryMoves(
  snapshot: InventorySnapshot,
  input: InventoryPlanInput & { moves: InventoryMovePreviewInput[] },
  resolveCatalog: InventoryCatalogResolver,
): InventoryMovePreview {
  const prepared = prepare(snapshot, input);
  if (!prepared.ok) return prepared;
  if (!input.moves.length || input.moves.length > 100) return { ok: false, error: 'invalid-batch' };
  const seenSlots = new Set<string>(),
    seenItems = new Set<string>();
  const pairings: Extract<InventoryMovePreview, { ok: true }>['pairings'] = [];
  let affected = 0;
  for (const move of input.moves) {
    if (!['cancel', 'unassign', 'swap'].includes(move.occupied) || move.source.slotId === move.destination.slotId)
      return { ok: false, error: 'invalid-batch' };
    const destination = prepared.snapshot.binders
      .find((b) => b.collectionId === move.destination.collectionId)
      ?.slots.find((s) => s.id === move.destination.slotId);
    if (!destination) return fail('invalid-destination');
    const displaced = destination.inventoryItemId;
    if (displaced !== null && move.occupied === 'cancel') return { ok: false, error: 'destination-occupied' };
    if (displaced === null && move.occupied === 'swap') return { ok: false, error: 'invalid-batch' };
    const itemIds = [move.inventoryItemId, ...(displaced === null ? [] : [displaced])];
    if (
      itemIds.some((id) => seenItems.has(id)) ||
      [move.source.slotId, move.destination.slotId].some((id) => seenSlots.has(id))
    )
      return { ok: false, error: 'invalid-batch' };
    affected += 2 + itemIds.length;
    if (affected > 256) return { ok: false, error: 'invalid-batch' };
    const forward = planMoveInventory(
      prepared.snapshot,
      { ...move, inventoryRevision: input.inventoryRevision, context: input.context },
      resolveCatalog,
    );
    if (!forward.ok) return forward;
    if (move.occupied === 'swap' && displaced !== null) {
      const item = prepared.snapshot.items.find((i) => i.id === displaced)!;
      const placement = prepared.snapshot.placements.find((p) => p.inventoryItemId === displaced)!;
      const reverse = planMoveInventory(
        prepared.snapshot,
        {
          inventoryRevision: input.inventoryRevision,
          context: input.context,
          inventoryItemId: displaced,
          itemVersion: item.version,
          placementVersion: placement.version,
          source: move.destination,
          destination: move.source,
        },
        resolveCatalog,
      );
      if (!reverse.ok) return reverse;
    }
    itemIds.forEach((id) => seenItems.add(id));
    seenSlots.add(move.source.slotId);
    seenSlots.add(move.destination.slotId);
    pairings.push({
      inventoryItemId: move.inventoryItemId,
      sourceSlotId: move.source.slotId,
      destinationSlotId: move.destination.slotId,
      displacedInventoryItemId: displaced,
      occupied: move.occupied,
    });
  }
  return { ok: true, pairings };
}
