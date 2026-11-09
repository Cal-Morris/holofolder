"use client"

import type { BinderDisplaySlot } from "@/lib/binder-display-model"
import { OrderedSlot } from "@/components/binder/ordered-slot"

/** Uses the same slot/copy identities and detail action as the real BinderApp grid. */
export default function CollectionSlotList({ slots, search, onSearch, onSelect, highlight }: {
  slots: readonly BinderDisplaySlot[]; search: string; onSearch: (value: string) => void; onSelect: (id: string) => void; highlight?: string
}) {
  const query = search.trim().toLocaleLowerCase()
  const shown = slots.filter(s => !query || [s.card?.name, s.pokemon?.name, s.id].some(text => text?.toLocaleLowerCase().includes(query)))
  return <section id="collection-browser-scroll" aria-label="Collection slots" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 pb-[var(--dock-clearance)]">
    <label className="block text-sm">Filter collection<input type="search" aria-label="Filter collection" value={search} onChange={e => onSearch(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border px-3 text-base" /></label>
    <p className="text-sm">{shown.length} slots</p>
    <ul className="space-y-2">{shown.map(slot => <li key={slot.id} className="flex min-w-0 gap-3 rounded-xl border p-2">
      <div className="h-28 w-20 shrink-0"><OrderedSlot slot={slot} selected={slot.id === highlight} onSelect={onSelect} imageSizes="80px" glareStyle={{}} glare={false} /></div>
      <div className="min-w-0 text-sm"><p className="break-words">{slot.card?.name ?? slot.pokemon?.name ?? "Free slot"}</p><p>{slot.item ? "Owned copy" : slot.target ? "Unfilled target" : "Empty spacer"}</p></div>
    </li>)}</ul>
    {!shown.length && <p>No matching slots.</p>}
  </section>
}
