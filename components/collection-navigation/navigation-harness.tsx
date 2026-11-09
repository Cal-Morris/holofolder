"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import CollectionNavigationHost, { type CollectionNavigationHostProps } from "./navigation-host"
import { OrderedSlot } from "@/components/binder/ordered-slot"
import { buildSlotDisplay, paginateDisplaySlots } from "@/lib/binder-display-model"
import { LayoutToolbar } from "@/components/binder/layout-editor"
import { getPokemonSummary } from "@/lib/pokemon-catalog"
import type { CollectionNavigationRead } from "@/lib/collection-navigation"
import { navigationIndex } from "@/lib/collection-navigation"
import { completeInventoryBrowseFixture, inventoryBrowseFixture, inventoryBrowseCatalog, inventoryBrowseLayouts } from "@/tests/fixtures/inventory-browse"
import type { InventoryCatalogResolver } from "@/lib/domain/inventory"

const DexListView = dynamic(() => import("@/components/dex-list-view"), { ssr: false })
const catalogResolver: InventoryCatalogResolver = () => undefined
const noop = () => {}
type CollectionContext = Parameters<CollectionNavigationHostProps["renderCollection"]>[0]
function CollectionPresentation({ read, collectionId, state, highlight, onChange }: CollectionContext) {
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const index = navigationIndex(read.scope, read)
  if (index.kind !== "complete" || read.evidence.kind !== "complete") return <p role="status">Cached collection only. Connect to load its full ordered pages.</p>
  const snapshot = read.evidence.snapshot, binder = snapshot.binders.find(b => b.collectionId === collectionId)
  const layout = read.layouts.find(l => l.collectionId === collectionId && l.layoutRevision === binder?.layoutRevision)
  if (!binder || !layout) return <p role="status">Ordered pages unavailable. Open Inventory.</p>
  const slots = buildSlotDisplay(binder, snapshot, id => read.catalog.find(c => c.card.id === id)?.card)
  const pages = paginateDisplaySlots(slots, layout.rows, layout.cols)
  const page = Math.min(state.page, pages.length || 1)
  const shown = state.view === "list" ? slots : pages[page - 1] ?? []
  return <section aria-label="Collection presentation" className="mx-auto max-w-3xl space-y-3 p-4">
    <h1 className="text-xl font-bold">{snapshot.collections.find(c => c.id === collectionId)?.name}</h1>
    <LayoutToolbar editing={editing} onToggle={() => { setEditing(v => !v); setSelected(null) }} boundary={{ snapshot,
      scope: { ownerUserId: read.scope.ownerUserId, collectionId, slotId: selected }, catalog: catalogResolver, onCommandIntent: noop }} />
    <label>Filter collection<input aria-label="Filter collection" value={state.search} onChange={e => { setSelected(null); setEditing(false); onChange({ search: e.target.value }) }} /></label>
    <p>Page {page} of {pages.length || 1}</p>
    <div aria-label="Ordered slots" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${state.view === "list" ? 1 : layout.cols}, minmax(0, 1fr))` }}>
      {shown.map((slot, n) => slot && (!state.search || (slot.card?.name ?? "Free slot").toLowerCase().includes(state.search.toLowerCase())) ? <div key={slot.id} className="min-w-0" style={{ height: state.view === "list" ? 100 : 145 }}>
        <OrderedSlot slot={slot} selected={selected === slot.id || highlight?.slotId === slot.id} onSelect={setSelected}
          interactionKey={`${editing}:${collectionId}:${state.view}`} imageSizes="120px" glareStyle={{}} glare={false} />
      </div> : <div key={`empty-${n}`} />)}
    </div>
    <div className="flex gap-3"><button className="min-h-11 border p-2" disabled={page <= 1} onClick={() => { setSelected(null); setEditing(false); onChange({ page: page - 1 }) }}>Previous page</button>
      <button className="min-h-11 border p-2" disabled={page >= pages.length} onClick={() => { setSelected(null); setEditing(false); onChange({ page: page + 1 }) }}>Next page</button></div>
    <p>Read-only synthetic presentation. Layout drafts are not saved.</p>
  </section>
}
function NationalDex() {
  return <section aria-label="National Dex" className="p-4"><h1>National Dex</h1><DexListView pokemonList={[1, 4, 7, 143].map(id => getPokemonSummary(id)!)} collectionByPokemonId={new Map()}
    pricesByKey={{}} getPriceKey={() => null} formatPrice={() => null} readOnly onSelectPokemon={noop} onToggleOwned={noop} onAddCard={noop} onAddWanted={noop} onTogglePerfect={noop} /></section>
}
/** Local synthetic adapter using the real Inventory, ordered-slot, layout toolbar and missing-Dex list. */
export default function NavigationHarness() {
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof completeInventoryBrowseFixture>> | null>(null)
  const [account, setAccount] = useState("synthetic-owner")
  const [mode, setMode] = useState("complete")
  useEffect(() => { void completeInventoryBrowseFixture(inventoryBrowseFixture(85)).then(setSnapshot) }, [])
  if (!snapshot) return <p role="status">Loading synthetic navigation evidence</p>
  const scope = { sessionId: `synthetic-session-${account}`, accountUserId: account, ownerUserId: account === "synthetic-other" ? account : "synthetic-owner" }
  const read: CollectionNavigationRead = { scope: { sessionId: `synthetic-session-${account}`, accountUserId: account === "synthetic-other" ? "synthetic-owner" : account, ownerUserId: "synthetic-owner" },
    evidence: !snapshot || mode === "unavailable" ? { kind: "unavailable" } : mode === "cached" ? { kind: "cached", snapshot } : { kind: "complete", snapshot },
    catalog: inventoryBrowseCatalog, layouts: inventoryBrowseLayouts }
  const fresh = async () => {
    if (mode === "failed") throw new Error("synthetic failed read")
    if (mode !== "moved" || !snapshot) return read
    const next = structuredClone(snapshot), placement = next.placements[0]
    Object.assign(next.binders[0].slots.find(s => s.id === placement.slotId)!, { inventoryItemId: null, status: null })
    const destination = next.binders[1].slots[0]
    destination.inventoryItemId = placement.inventoryItemId; destination.status = "collected"
    placement.collectionId = "trades"; placement.slotId = destination.id
    next.inventoryRevision++; next.binders.forEach(b => b.layoutRevision++)
    return { ...read, evidence: { kind: "complete" as const, snapshot: await completeInventoryBrowseFixture(next) },
      layouts: inventoryBrowseLayouts.map(l => ({ ...l, layoutRevision: l.layoutRevision + 1 })) }
  }
  return <>
    <aside aria-label="Synthetic navigation controls" className="p-4" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}>
      <p>Synthetic navigation harness, no production binding</p>
      <label>Account<select aria-label="Navigation account" className="min-h-11 w-full border text-base" value={account} onChange={e => setAccount(e.target.value)}>
        <option value="synthetic-owner">Owner</option><option value="synthetic-partner">Partner</option><option value="synthetic-other">Other account, stale read</option><option value="signed-out">Signed out</option>
      </select></label>
      <label>Evidence<select aria-label="Navigation evidence" className="min-h-11 w-full border text-base" value={mode} onChange={e => setMode(e.target.value)}>
        <option value="complete">Complete</option><option value="cached">Cached subset</option><option value="unavailable">Unavailable</option><option value="failed">Fresh read fails</option><option value="moved">Copy moved before open</option>
      </select></label>
    </aside>
    <CollectionNavigationHost scope={account === "signed-out" ? null : scope} read={read} readCurrent={fresh}
      renderCollection={context => <CollectionPresentation {...context} />} renderNationalDex={() => <NationalDex />} />
  </>
}
