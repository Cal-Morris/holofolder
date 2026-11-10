"use client"

import { useState } from "react"
import { useSlotDraftAcceptance } from "@/hooks/use-slot-draft-acceptance"
import { planNativePick, prepareSlotPickerIntent, type NativePickPlan, type SlotPickerAction, type SlotPickerBoundary, type SlotPickerIntent } from "@/lib/slot-picker"
import type { InventoryCatalogResolver } from "@/lib/domain/inventory"
import { prepareInventoryAction } from "@/lib/inventory-actions"
import { slotDraftFailureMessage } from "@/lib/slot-draft-failure"
import type { CardFinish } from "@/lib/domain/cards"
import type { InventorySelection } from "@/lib/inventory-plans"
import type { SelectedWant } from "@/lib/domain/inventory-commands"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"

/**
 * Headless save for a card picked in the existing selector or search. It prepares the same slot-scoped assign,
 * hands it to the native durable sink and keeps the exact draft for a retry. The host UI only shows `question`.
 */
export function useNativeSlotPick(boundary: SlotPickerBoundary, onSaved: () => void) {
  const { snapshot, scope, catalog, onCommandIntent } = boundary
  const acceptance = useSlotDraftAcceptance<SlotPickerIntent>(onCommandIntent, onSaved)
  const [picked, setPicked] = useState<{ card: SearchCardResult; plan: NativePickPlan } | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const save = (plan: NativePickPlan, selection: InventorySelection, fulfillWant: SelectedWant) => {
    setChoosing(false); setFailure(null)
    try {
      const prepared = prepareSlotPickerIntent(snapshot, scope, { kind: "assign", selection, fulfillWant },
        { source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() }, plan.resolver)
      acceptance.handoff({ scope: prepared.scope, intent: prepared.intent }, plan.resolver, plan.picked)
    } catch (cause) { setFailure(slotDraftFailureMessage(cause)) }
  }
  const pick = (card: SearchCardResult, finish: CardFinish | undefined) => {
    if (acceptance.pending || acceptance.busy) return
    try {
      const plan = planNativePick(snapshot, scope, card, finish, catalog, crypto.randomUUID())
      setPicked({ card, plan })
      if (plan.immediate) save(plan, plan.immediate, null)
      else { setFailure(null); setChoosing(true) }
    } catch (cause) { setFailure(slotDraftFailureMessage(cause)) }
  }
  // A failed handoff keeps its exact draft; the message is only shown while that draft is retained.
  const failed = acceptance.pending ? acceptance.message : failure
  const dismiss = () => { if (acceptance.busy) return; acceptance.discard(); setPicked(null); setChoosing(false); setFailure(null) }
  return {
    pick, busy: acceptance.busy, dismiss,
    question: picked && (choosing || failed) ? { card: picked.card, plan: picked.plan, failed, retry: acceptance.pending ? acceptance.retry : null,
      choose: (selection: InventorySelection, want: number | null) => save(picked.plan, selection, want === null ? null : picked.plan.wanted(want)) } : null,
  }
}

/**
 * Headless save for a pocket action that is not a card pick: taking the card out, removing that exact card from the
 * collection, or changing what the pocket is reserved for. Same durable sink and exact-draft retry as a pick; the
 * host shows `failed` only on a real failure.
 */
export function useNativeSlotAction(boundary: SlotPickerBoundary | undefined, onSaved: () => void) {
  const acceptance = useSlotDraftAcceptance<SlotPickerIntent>(boundary?.onCommandIntent ?? (() => { throw new Error("inactive-or-unavailable-session") }), onSaved)
  const [failure, setFailure] = useState<string | null>(null)
  const run = (action: Exclude<SlotPickerAction, { kind: "assign" }> | { kind: "removeOwned" }, selected?: InventoryCatalogResolver) => {
    if (!boundary || acceptance.pending || acceptance.busy) return
    setFailure(null)
    try {
      const context = { source: "app" as const, clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() }
      if (action.kind === "removeOwned") {
        // The exact copy in this pocket, by its own ID and version: the existing owned-copy removal, never a lookup by card.
        const itemId = boundary.snapshot.binders.find(b => b.collectionId === boundary.scope.collectionId)?.slots.find(s => s.id === boundary.scope.slotId)?.inventoryItemId
        if (!itemId) throw new Error("picker-scope-changed")
        const prepared = prepareInventoryAction(boundary.snapshot, { kind: "removeOwned", itemId }, context, boundary.catalog)
        acceptance.handoff({ scope: { ...boundary.scope }, intent: prepared.intent })
        return
      }
      const resolver = selected ?? boundary.catalog
      const prepared = prepareSlotPickerIntent(boundary.snapshot, boundary.scope, action, context, resolver)
      acceptance.handoff({ scope: prepared.scope, intent: prepared.intent }, selected)
    } catch (cause) { setFailure(slotDraftFailureMessage(cause)) }
  }
  return { run, busy: acceptance.busy, failed: acceptance.pending ? acceptance.message : failure, retry: acceptance.pending ? acceptance.retry : null,
    dismiss: () => { if (acceptance.busy) return; acceptance.discard(); setFailure(null) } }
}
