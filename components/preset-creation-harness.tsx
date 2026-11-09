"use client"

import { useEffect, useState } from "react"
import BinderSwitcherSheet from "@/components/binder-switcher-sheet"
import { BinderGoalProgress } from "@/components/binder-goal-progress"
import { instantiatePreset } from "@/lib/domain/binder-presets"
import { closeAllOverlays } from "@/hooks/use-overlay"
import type { BinderCreationDraft } from "@/lib/binder-creation-draft"
import { syntheticSlotPickerSnapshot } from "@/tests/fixtures/slot-picker"
import { pickerCandidate } from "@/lib/slot-picker"
import type { Binder } from "@/lib/binders/model"

/** Synthetic UI evidence only. No executor, durable state, audit event or queue ACK. */
export default function PresetCreationHarness() {
  const [open, setOpen] = useState(false)
  const [online, setOnline] = useState(true)
  const [draft, setDraft] = useState<BinderCreationDraft | null>(null)
  const [data, setData] = useState(syntheticSlotPickerSnapshot)
  const [worstCase, setWorstCase] = useState(false)
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync(); window.addEventListener("online", sync); window.addEventListener("offline", sync)
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync) }
  }, [])
  const ownerUserId = data.inventory.ownerUserId
  const binders: Binder[] = [{ id: data.binder.collectionId, ownerUserId, name: worstCase ? "Maushold, Tandemaus and Snorlax collection" : "Synthetic binder", color: null, sortOrder: 0, isDefault: true, rows: null, cols: null, createdAt: null, updatedAt: null }]
  const receive = (next: BinderCreationDraft) => {
    setDraft(next)
    const binder = instantiatePreset(JSON.parse(JSON.stringify(next.manifest)), { ownerUserId, collectionId: data.binder.collectionId }, next.manifest.entries.map((_, i) => `synthetic-draft-slot-${i}`))!
    setData(previous => ({ ...previous, binder, inventory: { ...previous.inventory, binders: [binder], placements: [] } }))
  }
  return <main className="mx-auto max-w-md space-y-4 px-4 pb-[var(--dock-clearance)] pt-[calc(var(--top-inset)+1rem)]">
    <h1 className="text-lg font-semibold">Synthetic preset preview</h1>
    <p className="text-sm">Internal draft demo. Nothing here is saved.</p>
    <button className="min-h-11 rounded-xl border px-3" onClick={() => setWorstCase(v => !v)}>{worstCase ? "Demo data" : "Worst case"}</button>
    <BinderGoalProgress inventory={data.inventory} binder={data.binder} catalog={id => { const card = data.cards.find(c => c.id === id); return card ? pickerCandidate(card) : undefined }} />
    <output aria-label="Prepared creation draft" className="block break-words text-xs">{draft ? JSON.stringify(draft) : "No draft"}</output>
    <div className="flex flex-wrap gap-2">{["Remove last target", "Make last target free", "Retarget last to Pikachu"].map((label, index) => <button key={label} className="min-h-10 rounded-xl border px-3 text-sm" onClick={() => setData(previous => {
      const next = structuredClone(previous)
      if (index === 0) next.binder.slots.pop()
      else if (next.binder.slots.length) next.binder.slots.at(-1)!.target = index === 1 ? null : { kind: "pokemon", pokemonId: 25 }
      next.inventory.binders = [next.binder]
      return next
    })}>{label}</button>)}</div>
    <nav aria-label="Main navigation" className="fixed inset-x-3 bottom-[var(--dock-inset)] z-[60] mx-auto flex h-[var(--dock-bar)] max-w-md items-center justify-around rounded-2xl bg-card shadow-lg">
      <button className="min-h-11 px-4" onClick={() => setOpen(true)}>Binders</button><button className="min-h-11 px-4" onClick={() => closeAllOverlays()}>List</button>
    </nav>
    {open && <BinderSwitcherSheet binders={binders} activeBinderId={data.binder.collectionId} canManage isOnline={online} onSwitch={() => setOpen(false)} onBindersChange={() => {}} onClose={() => setOpen(false)} stagedCreation={{ ownerUserId, onDraft: receive }} />}
  </main>
}
