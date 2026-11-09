import {
  canChangeSlotTarget, isSlotRevision, normalizeBinderSlot, normalizeBinderSnapshot, normalizeSlotTarget,
  type BinderSlot, type BinderSnapshot, type SlotTarget, type SlotTargetCandidate,
} from "@/lib/domain/binder-slots"

export type BinderSlotPlan =
  | { ok: false; error: "invalid-snapshot" | "layout-conflict" | "invalid-selection" | "invalid-anchor" | "invalid-insert" | "invalid-target" | "occupied-target" | "revision-overflow" }
  | {
    ok: true
    baseLayoutRevision: number
    expectedSlotVersions: Record<string, number>
    snapshot: BinderSnapshot
    /** Atomic execution must remove placements, retaining the inventory items as Unassigned. */
    unassignedInventoryItemIds: string[]
  }

type Prepared = Extract<BinderSlotPlan, { ok: true }>
function prepare(snapshot: BinderSnapshot, expectedLayoutRevision: number): BinderSlotPlan {
  const copy = normalizeBinderSnapshot(snapshot)
  if (!copy) return { ok: false, error: "invalid-snapshot" }
  if (!isSlotRevision(expectedLayoutRevision) || copy.layoutRevision !== expectedLayoutRevision) return { ok: false, error: "layout-conflict" }
  return { ok: true, baseLayoutRevision: expectedLayoutRevision, expectedSlotVersions: {}, snapshot: copy, unassignedInventoryItemIds: [] }
}

function select(plan: Prepared, ids: readonly string[]): BinderSlot[] | undefined {
  if (!ids.length || new Set(ids).size !== ids.length) return undefined
  const selected = plan.snapshot.slots.filter(slot => ids.includes(slot.id))
  if (selected.length !== ids.length) return undefined
  return selected
}

function bumpLayout(plan: Prepared): BinderSlotPlan {
  if (plan.snapshot.layoutRevision === Number.MAX_SAFE_INTEGER) return { ok: false, error: "revision-overflow" }
  plan.snapshot.layoutRevision++
  return plan
}

/** Insert before a stable anchor; null appends. No empty-pocket search or implicit padding. */
export function planInsertSlots(snapshot: BinderSnapshot, expectedLayoutRevision: number, slots: readonly BinderSlot[], beforeSlotId: string | null): BinderSlotPlan {
  const plan = prepare(snapshot, expectedLayoutRevision)
  if (!plan.ok) return plan
  const index = beforeSlotId === null ? plan.snapshot.slots.length : plan.snapshot.slots.findIndex(slot => slot.id === beforeSlotId)
  if (index < 0) return { ok: false, error: "invalid-anchor" }
  const inserted = Array.from(slots, normalizeBinderSlot)
  if (!inserted.length || inserted.some(slot => !slot || slot.target !== null || slot.inventoryItemId !== null || slot.wantedCards.length || slot.status !== null || slot.version !== 0 || slot.presetOrigin !== null)) return { ok: false, error: "invalid-insert" }
  plan.snapshot.slots.splice(index, 0, ...inserted as BinderSlot[])
  const valid = normalizeBinderSnapshot(plan.snapshot)
  if (!valid) return { ok: false, error: "invalid-insert" }
  plan.snapshot = valid
  return bumpLayout(plan)
}

/** Move whole slots, preserving saved relative order, regardless of selection input order. */
export function planMoveSlots(snapshot: BinderSnapshot, expectedLayoutRevision: number, slotIds: readonly string[], beforeSlotId: string | null): BinderSlotPlan {
  const plan = prepare(snapshot, expectedLayoutRevision)
  if (!plan.ok) return plan
  const selected = select(plan, slotIds)
  if (!selected) return { ok: false, error: "invalid-selection" }
  if (beforeSlotId !== null && (slotIds.includes(beforeSlotId) || !plan.snapshot.slots.some(slot => slot.id === beforeSlotId))) return { ok: false, error: "invalid-anchor" }
  const rest = plan.snapshot.slots.filter(slot => !slotIds.includes(slot.id))
  const index = beforeSlotId === null ? rest.length : rest.findIndex(slot => slot.id === beforeSlotId)
  rest.splice(index, 0, ...selected)
  if (rest.every((slot, index) => slot.id === plan.snapshot.slots[index].id)) return plan
  plan.snapshot.slots = rest
  return bumpLayout(plan)
}

/** Clear only the item reference and owned status. Targets/wants/spacers remain saved. */
export function planClearSlots(snapshot: BinderSnapshot, expectedLayoutRevision: number, slotIds: readonly string[]): BinderSlotPlan {
  const plan = prepare(snapshot, expectedLayoutRevision)
  if (!plan.ok) return plan
  const selected = select(plan, slotIds)
  if (!selected) return { ok: false, error: "invalid-selection" }
  plan.expectedSlotVersions = Object.fromEntries(selected.filter(slot => slot.inventoryItemId !== null).map(slot => [slot.id, slot.version]))
  for (const slot of selected) {
    if (slot.inventoryItemId === null) continue
    if (slot.version === Number.MAX_SAFE_INTEGER) return { ok: false, error: "revision-overflow" }
    plan.unassignedInventoryItemIds.push(slot.inventoryItemId)
    slot.inventoryItemId = null
    slot.status = null
    slot.version++
  }
  return plan
}

/** Removing a slot removes its goal/wants, never inventory ownership. */
export function planRemoveSlots(snapshot: BinderSnapshot, expectedLayoutRevision: number, slotIds: readonly string[]): BinderSlotPlan {
  const plan = prepare(snapshot, expectedLayoutRevision)
  if (!plan.ok) return plan
  const selected = select(plan, slotIds)
  if (!selected) return { ok: false, error: "invalid-selection" }
  plan.expectedSlotVersions = Object.fromEntries(selected.map(slot => [slot.id, slot.version]))
  for (const slot of selected) {
    if (slot.inventoryItemId !== null) plan.unassignedInventoryItemIds.push(slot.inventoryItemId)
  }
  plan.snapshot.slots = plan.snapshot.slots.filter(slot => !slotIds.includes(slot.id))
  return bumpLayout(plan)
}

/** Evidence must describe this slot's actual item, resolved by the authoritative adapter. */
export function planChangeSlotTarget(snapshot: BinderSnapshot, expectedLayoutRevision: number, slotId: string, target: SlotTarget | null, candidate?: SlotTargetCandidate): BinderSlotPlan {
  const plan = prepare(snapshot, expectedLayoutRevision)
  if (!plan.ok) return plan
  const slot = plan.snapshot.slots.find(slot => slot.id === slotId)
  if (!slot) return { ok: false, error: "invalid-selection" }
  const normalized = normalizeSlotTarget(target)
  if (normalized === undefined) return { ok: false, error: "invalid-target" }
  if (JSON.stringify(slot.target) === JSON.stringify(normalized)) return plan
  if (!canChangeSlotTarget(slot, normalized, candidate)) return { ok: false, error: "occupied-target" }
  if (slot.version === Number.MAX_SAFE_INTEGER) return { ok: false, error: "revision-overflow" }
  plan.expectedSlotVersions = { ...plan.expectedSlotVersions, [slot.id]: slot.version }
  slot.target = normalized
  slot.version++
  return plan
}
