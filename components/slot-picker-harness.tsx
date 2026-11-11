"use client"

import { useEffect, useRef, useState, type ComponentProps } from "react"
import BinderApp from "@/components/binder-app"
import { syntheticSlotPickerSnapshot } from "@/tests/fixtures/slot-picker"
import { pickerCandidate } from "@/lib/slot-picker"
import type { StagedSlotCommandIntent } from "@/lib/binder-slot-editing"
import { parseSlotIntent, projectSlotIntent } from "@/lib/collection/slot-optimistic"

/** Imported only by the hard-gated e2e page. No persistence, transport, ownership store or ACK. */
export default function SlotPickerHarness(props: ComponentProps<typeof BinderApp>) {
  const rejectNext = useRef(false)
  const [rejectedDraft, setRejectedDraft] = useState<StagedSlotCommandIntent | null>(null)
  const [data, setData] = useState(syntheticSlotPickerSnapshot)
  useEffect(() => {
    const changeScope = (event: Event) => {
      const kind = (event as CustomEvent<string>).detail
      if (kind !== "owner" && kind !== "binder") return
      setData(previous => {
        const next = structuredClone(previous)
        const owner = kind === "owner" ? `${next.inventory.ownerUserId}-other` : next.inventory.ownerUserId
        const collection = kind === "binder" ? "00000000-0000-4000-8000-000000000367" : next.binder.collectionId
        next.inventory.ownerUserId = owner
        next.inventory.items.forEach(i => { i.ownerUserId = owner })
        next.inventory.collections.forEach(c => { c.ownerUserId = owner; c.id = collection })
        next.inventory.binders.forEach(b => { b.ownerUserId = owner; b.collectionId = collection; b.slots.forEach(s => { s.ownerUserId = owner; s.collectionId = collection }) })
        next.inventory.placements.forEach(p => { p.collectionId = collection })
        next.binder = next.inventory.binders[0]
        return next
      })
    }
    const reject = () => { rejectNext.current = true }
    const emptyLayout = () => setData(previous => {
      const next = structuredClone(previous)
      next.binder.slots = []
      next.inventory.placements = []
      return next
    })
    const changeGrade = (event: Event) => {
      const name = (event as CustomEvent<string>).detail
      if (typeof name !== "string" || name.length > 200) return
      setData(previous => {
        const next = structuredClone(previous)
        const copy = next.inventory.items.find(item => item.id === "unassigned-grade")
        if (copy?.grading) copy.grading.provider = { kind: "custom", name }
        return next
      })
    }
    // Synthetic exact wants on the empty Snorlax target, for the explicit fulfil choice.
    const addWants = (event: Event) => {
      // Either a list of wants for the empty Snorlax pocket, or { slotId, wants } for any pocket.
      const raw = (event as CustomEvent<{ card_id?: string }[] | { slotId: string; wants: { card_id?: string }[] }>).detail
      const { slotId, wants } = Array.isArray(raw) ? { slotId: "slot-e", wants: raw } : raw ?? { slotId: "", wants: [] }
      if (!Array.isArray(wants) || wants.length > 4) return
      setData(previous => {
        const next = structuredClone(previous)
        next.binder.slots.find(slot => slot.id === slotId)!.wantedCards = wants.map(({ card_id, ...rest }: { card_id?: string }) => ({ card_id, card_name: "Snorlax A", added_at: "2026-11-10T00:00:00.000Z", ...rest })) as typeof next.binder.slots[number]["wantedCards"]
        next.inventory.binders = [next.binder]
        return next
      })
    }
    window.addEventListener("synthetic-slot-wants", addWants)
    window.addEventListener("synthetic-layout-reject-once", reject)
    window.addEventListener("synthetic-layout-empty", emptyLayout)
    window.addEventListener("synthetic-slot-scope-change", changeScope)
    window.addEventListener("synthetic-slot-grading-change", changeGrade)
    return () => {
      window.removeEventListener("synthetic-slot-wants", addWants)
      window.removeEventListener("synthetic-layout-reject-once", reject)
      window.removeEventListener("synthetic-layout-empty", emptyLayout)
      window.removeEventListener("synthetic-slot-scope-change", changeScope)
      window.removeEventListener("synthetic-slot-grading-change", changeGrade)
    }
  }, [])
  const [drafts, setDrafts] = useState<StagedSlotCommandIntent[]>([])
  const catalog = (id: string) => {
    const card = data.cards.find(c => c.id === id || c.canonicalId === id || c.aliasIds?.includes(id))
    return card ? pickerCandidate(card) : undefined
  }
  const receive = (draft: StagedSlotCommandIntent) => {
    if (draft.scope.ownerUserId !== data.inventory.ownerUserId || draft.scope.collectionId !== data.binder.collectionId) throw new Error("harness-scope-changed")
    if (rejectNext.current) {
      rejectNext.current = false
      setRejectedDraft(draft)
      throw new Error("synthetic-rejection-before-handoff")
    }
    const intent = parseSlotIntent(draft.intent)
    const inventory = projectSlotIntent(data.inventory, intent, catalog)
    setDrafts(previous => [...previous, { scope: draft.scope, intent }])
    setData({ ...data, inventory, binder: inventory.binders[0] })
  }
  return <>
    <output aria-label="Synthetic latest draft" className="sr-only">{JSON.stringify(drafts.at(-1) ?? null)}</output>
    <output aria-label="Synthetic rejected draft" className="sr-only">{JSON.stringify(rejectedDraft)}</output>
    <output aria-label="Synthetic draft count" className="sr-only">{drafts.length}</output>
    <output aria-label="Synthetic want count" className="sr-only">{data.binder.slots.find(slot => slot.id === "slot-e")?.wantedCards.length ?? 0}</output>
    <BinderApp {...props} stagedSlotDisplay={data} stagedSlotCatalog={catalog} onStagedSlotCommandIntent={receive} />
  </>
}
