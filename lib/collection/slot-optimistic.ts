import { normalizeAuditContext, type OperationIntentContext } from "@/lib/domain/audit-context"
import { parseSlotCommand, type SlotCommandRequest, type SlotPrecondition } from "@/lib/domain/slot-commands"
import { parseInventoryCommand, type InventoryCommandRequest, type InventoryItemRef, type InventorySlotRef } from "@/lib/domain/inventory-commands"
import { normalizeInventorySnapshot, inventoryItemCandidate, type InventorySnapshot, type InventoryCatalogResolver } from "@/lib/domain/inventory"
import { planInsertSlots, planMoveSlots, planClearSlots, planRemoveSlots, planChangeSlotTarget } from "@/lib/binder-slot-plans"
import { planAssignInventory, planMoveInventory, planUnassignInventory, planEditInventoryMetadata, previewInventoryMoves } from "@/lib/inventory-plans"
import { isContractRecord, isSlotRevision, matchesSlotTarget } from "@/lib/domain/binder-slots"

export type SlotOfflineIntent = { kind: "slots"; request: SlotCommandRequest; context: OperationIntentContext }
  | { kind: "inventory"; request: InventoryCommandRequest; context: OperationIntentContext }
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
function fail(reason: string): never { throw new Error(reason) }
export function parseSlotIntent(value: unknown): SlotOfflineIntent {
  if (!isContractRecord(value, ["kind", "request", "context"]) || !isContractRecord(value.context, ["source", "clientId", "operationId", "batchId", "clientOccurredAt"])) return fail("invalid-intent")
  const context = normalizeAuditContext({ ...value.context, actor: { kind: "unknown" }, affectedEntities: { inventoryItemIds: [], slotIds: [], collectionIds: [] } })
  if (!context) return fail("invalid-intent")
  const { actor: _actor, affectedEntities: _entities, ...intentContext } = context
  const request = value.kind === "slots" ? parseSlotCommand(value.request) : value.kind === "inventory" ? parseInventoryCommand(value.request) : fail("invalid-intent")
  if (request.operationId !== context.operationId) return fail("operation-id-mismatch")
  return { kind: value.kind, request, context: intentContext } as SlotOfflineIntent
}
export function checkSlotRef(snapshot: InventorySnapshot, collectionId: string, ref: SlotPrecondition) {
  const slot = snapshot.binders.find(b => b.collectionId === collectionId)?.slots.find(s => s.id === ref.id)
  if (!slot || slot.version !== ref.version || slot.inventoryItemId !== ref.inventoryItemId) return fail("slot-conflict")
  const item = snapshot.items.find(i => i.id === ref.inventoryItemId), placement = snapshot.placements.find(p => p.inventoryItemId === ref.inventoryItemId)
  if ((item?.version ?? null) !== ref.itemVersion || (placement?.version ?? null) !== ref.placementVersion
    || (placement && (placement.collectionId !== collectionId || placement.slotId !== ref.id))) return fail("placement-conflict")
  return slot
}

/** Local preview only. Server predicates/ledger remain authoritative. No actor authority is persisted. */
export function projectSlotIntent(base: InventorySnapshot, raw: SlotOfflineIntent, catalog: InventoryCatalogResolver): InventorySnapshot {
  const intent = parseSlotIntent(raw)
  let state = normalizeInventorySnapshot(base) ?? fail("invalid-snapshot")
  const original = structuredClone(state), touched = new Set<string>(), structural = new Set<string>()
  const { request } = intent
  if (request.inventoryRevision !== state.inventoryRevision) return fail("inventory-conflict")
  const collections = intent.kind === "slots" ? [{ collectionId: intent.request.collectionId, version: intent.request.collectionVersion, layoutRevision: intent.request.layoutRevision }] : intent.request.collections
  for (const ref of collections) {
    if (state.collections.find(c => c.id === ref.collectionId)?.version !== ref.version) return fail("collection-conflict")
    if (state.binders.find(b => b.collectionId === ref.collectionId)?.layoutRevision !== ref.layoutRevision) return fail("layout-conflict")
  }
  const context = { ...intent.context, actor: { kind: "unknown" as const }, affectedEntities: { inventoryItemIds: [], slotIds: [], collectionIds: [] } }
  const input = () => ({ inventoryRevision: state.inventoryRevision, context })
  const slotRevision = (ref: InventorySlotRef) => ({ collectionId: ref.collectionId, slotId: ref.slot.id, slotVersion: ref.slot.version, layoutRevision: state.binders.find(b => b.collectionId === ref.collectionId)!.layoutRevision })
  const placedInput = (ref: InventoryItemRef) => {
    if (!ref.placement) return fail("placement-conflict")
    return { ...input(), inventoryItemId: ref.itemId, itemVersion: ref.itemVersion, placementVersion: ref.placement.slot.placementVersion!, source: slotRevision(ref.placement) }
  }
  const apply = (plan: ReturnType<typeof planAssignInventory>) => { if (!plan.ok) return fail(plan.error); state = plan.snapshot }
  const checkItem = (ref: InventoryItemRef) => {
    if (original.items.find(i => i.id === ref.itemId)?.version !== ref.itemVersion) return fail("item-conflict")
    const placement = original.placements.find(p => p.inventoryItemId === ref.itemId)
    if (ref.placement) checkSlotRef(original, ref.placement.collectionId, ref.placement.slot)
    else if (placement) return fail("placement-conflict")
  }
  if (intent.kind === "slots") {
    const id = intent.request.collectionId, used = new Set<string>()
    for (const command of intent.request.commands) {
      const binder = state.binders.find(b => b.collectionId === id)!
      const ids = command.kind === "create" ? command.ids : (command.kind === "update" ? [command.slot] : command.slots).map(s => s.id)
      for (const slotId of ids) { if (used.has(slotId)) return fail("duplicate-slot"); used.add(slotId) }
      if (command.kind !== "create") for (const ref of command.kind === "update" ? [command.slot] : command.slots) checkSlotRef(original, id, ref)
      let plan: ReturnType<typeof planMoveSlots>
      if (command.kind === "create") {
        plan = planInsertSlots(binder, binder.layoutRevision, command.ids.map(slotId => ({ id: slotId, ownerUserId: state.ownerUserId, collectionId: id, target: null, inventoryItemId: null, wantedCards: [], status: null, version: 0, presetOrigin: null })), command.beforeSlotId)
      } else if (command.kind === "move") plan = planMoveSlots(binder, binder.layoutRevision, command.slots.map(s => s.id), command.beforeSlotId)
      else if (command.kind === "clear" || command.kind === "remove") {
        plan = command.kind === "clear" ? planClearSlots(binder, binder.layoutRevision, command.slots.map(s => s.id)) : planRemoveSlots(binder, binder.layoutRevision, command.slots.map(s => s.id))
      } else if (command.kind === "update") {
        const slot = binder.slots.find(s => s.id === command.slot.id)!
        const item = state.items.find(i => i.id === slot.inventoryItemId)
        plan = "target" in command ? planChangeSlotTarget(binder, binder.layoutRevision, slot.id, command.target!, item ? inventoryItemCandidate(item, catalog) : undefined)
          : { ok: true, snapshot: structuredClone(binder), baseLayoutRevision: binder.layoutRevision, expectedSlotVersions: {}, unassignedInventoryItemIds: [] }
        if (plan.ok && command.wantedCards) {
          const updated = plan.snapshot.slots.find(s => s.id === slot.id)!
          if (!sameValue(updated.wantedCards, command.wantedCards)) { updated.wantedCards = structuredClone(command.wantedCards); updated.version = slot.version + 1 }
        }
      } else return fail("invalid-command")
      if (!plan.ok) return fail(plan.error)
      if (!sameValue(binder, plan.snapshot)) touched.add(id)
      if (binder.layoutRevision !== plan.snapshot.layoutRevision) structural.add(id)
      state.binders = state.binders.map(b => b.collectionId === id ? plan.snapshot : b)
      state.placements = state.placements.filter(p => !plan.unassignedInventoryItemIds.includes(p.inventoryItemId))
    }
  } else {
    const used = new Set<string>()
    for (const c of intent.request.commands) {
      const before = structuredClone(state)
      const refs: InventorySlotRef[] = []
      if ("item" in c) { checkItem(c.item); if (c.item.placement) refs.push(c.item.placement) }
      if ("destination" in c) refs.push(c.destination)
      if (c.kind === "removeSlots") refs.push(...c.slots)
      if (c.kind === "deleteCollection") refs.push(...c.slots.map(slot => ({ collectionId: c.collectionId, slot })))
      for (const ref of refs) { checkSlotRef(original, ref.collectionId, ref.slot); if (used.has(ref.slot.id)) return fail("overlapping-command"); used.add(ref.slot.id) }
      if (c.kind === "add") {
        if (state.items.some(i => i.id === c.itemId)) return fail("item-conflict")
        state.items.push({ id: c.itemId, ownerUserId: state.ownerUserId, identity: c.identity, grading: c.grading, acquiredAt: c.acquiredAt, version: 0 })
      } else if (c.kind === "edit") apply(planEditInventoryMetadata(state, { ...input(), inventoryItemId: c.item.itemId, itemVersion: c.item.itemVersion, grading: c.grading }))
      else if (c.kind === "removeOwned" || c.kind === "unassign") {
        if (c.item.placement) apply(planUnassignInventory(state, placedInput(c.item)))
        if (c.kind === "removeOwned") state.items = state.items.filter(i => i.id !== c.item.itemId)
      } else if (c.kind === "assign" || c.kind === "move") {
        const destination = state.binders.find(b => b.collectionId === c.destination.collectionId)!.slots.find(s => s.id === c.destination.slot.id)!
        const displacedId = destination.inventoryItemId
        const displaced = state.items.find(i => i.id === displacedId), placement = state.placements.find(p => p.inventoryItemId === displacedId)
        if (displacedId !== null && c.occupied === "cancel") return fail("destination-occupied")
        if (c.kind === "assign") apply(planAssignInventory(state, { ...input(), destination: slotRevision(c.destination), selection: c.selection }, catalog))
        else {
          const move = { ...placedInput(c.item), destination: slotRevision(c.destination), occupied: c.occupied }
          const preview = previewInventoryMoves(state, { ...input(), moves: [move] }, catalog)
          if (!preview.ok) return fail(preview.error)
          apply(planMoveInventory(state, move, catalog))
          if (c.occupied === "swap" && displaced && placement) {
            const source = state.binders.find(b => b.collectionId === c.item.placement!.collectionId)!.slots.find(s => s.id === c.item.placement!.slot.id)!
            apply(planAssignInventory(state, { ...input(), selection: { kind: "existing", inventoryItemId: displaced.id, itemVersion: displaced.version }, destination: { collectionId: source.collectionId, slotId: source.id, slotVersion: source.version, layoutRevision: state.binders.find(b => b.collectionId === source.collectionId)!.layoutRevision } }, catalog))
            // SQL versions each swapped slot once, including the cleared source.
            state.binders.find(b => b.collectionId === source.collectionId)!.slots.find(s => s.id === source.id)!.version = source.version
            state.placements.find(p => p.inventoryItemId === displaced.id)!.version = placement.version + 1
          }
        }
        if (c.fulfillWant) {
          const slot = state.binders.find(b => b.collectionId === c.destination.collectionId)!.slots.find(s => s.id === c.destination.slot.id)!
          if (!sameValue(slot.wantedCards[c.fulfillWant.index], c.fulfillWant.expected)) return fail("wanted-conflict")
          const assigned = state.items.find(i => i.id === slot.inventoryItemId)!
          const candidate = inventoryItemCandidate(assigned, catalog), want = c.fulfillWant.expected
          if (!candidate || !matchesSlotTarget(candidate, { kind: "card", cardId: want.card_id, ...(want.card_language ? { language: want.card_language } : {}), ...(want.card_finish ? { finish: want.card_finish } : {}) })) return fail("wanted-conflict")
          slot.wantedCards.splice(c.fulfillWant.index, 1)
        }
      } else {
        const ids = new Set(refs.map(r => r.slot.id))
        if (c.kind === "deleteCollection" && state.binders.find(b => b.collectionId === c.collectionId)!.slots.length !== ids.size) return fail("partial-collection")
        state.placements = state.placements.filter(p => !ids.has(p.slotId))
        state.binders = state.binders.map(b => {
          if (!b.slots.some(s => ids.has(s.id))) return b
          structural.add(b.collectionId)
          return { ...b, slots: b.slots.filter(s => !ids.has(s.id)) }
        })
        if (c.kind === "deleteCollection") {
          state.collections = state.collections.filter(col => col.id !== c.collectionId)
          state.binders = state.binders.filter(b => b.collectionId !== c.collectionId)
          touched.add(c.collectionId)
          if (c.replacementDefaultCollectionId) touched.add(c.replacementDefaultCollectionId)
        }
      }
      if (!sameValue(before, state)) for (const ref of refs) touched.add(ref.collectionId)
    }
  }
  if (!sameValue(original, state)) {
    state.inventoryRevision = original.inventoryRevision + 1
    state.collections = state.collections.map(c => ({ ...c, version: original.collections.find(b => b.id === c.id)!.version + (touched.has(c.id) ? 1 : 0) }))
    state.binders = state.binders.map(b => ({ ...b, layoutRevision: original.binders.find(a => a.collectionId === b.collectionId)!.layoutRevision + (structural.has(b.collectionId) ? 1 : 0) }))
  }
  if (!isSlotRevision(state.inventoryRevision) || state.collections.some(c => !isSlotRevision(c.version))) return fail("revision-overflow")
  return normalizeInventorySnapshot(state) ?? fail("invalid-projection")
}
