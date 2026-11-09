"use client"

import { useEffect, useState, type ComponentProps } from "react"
import BinderApp from "@/components/binder-app"
import { syntheticSlotPickerSnapshot } from "@/tests/fixtures/slot-picker"
import { pickerCandidate, type SlotPickerIntent } from "@/lib/slot-picker"
import { parseSlotIntent, projectSlotIntent } from "@/lib/collection/slot-optimistic"

/** Imported only by the hard-gated e2e page. No persistence, transport, ownership store or ACK. */
export default function SlotPickerHarness(props: ComponentProps<typeof BinderApp>) {
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
    window.addEventListener("synthetic-slot-scope-change", changeScope)
    window.addEventListener("synthetic-slot-grading-change", changeGrade)
    return () => {
      window.removeEventListener("synthetic-slot-scope-change", changeScope)
      window.removeEventListener("synthetic-slot-grading-change", changeGrade)
    }
  }, [])
  const [drafts, setDrafts] = useState<SlotPickerIntent[]>([])
  const catalog = (id: string) => {
    const card = data.cards.find(c => c.id === id || c.canonicalId === id || c.aliasIds?.includes(id))
    return card ? pickerCandidate(card) : undefined
  }
  const receive = (draft: SlotPickerIntent) => {
    if (draft.scope.ownerUserId !== data.inventory.ownerUserId || draft.scope.collectionId !== data.binder.collectionId) throw new Error("harness-scope-changed")
    const intent = parseSlotIntent(draft.intent)
    const inventory = projectSlotIntent(data.inventory, intent, catalog)
    setDrafts(previous => [...previous, { scope: draft.scope, intent }])
    setData({ ...data, inventory, binder: inventory.binders[0] })
  }
  return <>
    <output aria-label="Synthetic draft count" className="sr-only">{drafts.length}</output>
    <BinderApp {...props} stagedSlotDisplay={data} stagedSlotCatalog={catalog} onStagedSlotCommandIntent={receive} />
  </>
}
