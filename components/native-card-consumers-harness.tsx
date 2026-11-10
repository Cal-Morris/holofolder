"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import QuickMode from "@/components/quick-mode"
import QuickCardCheck from "@/components/quick-card-check"
import PokemonSearch from "@/components/pokemon-search"
import PokemonCardsBrowser from "@/components/pokemon-cards-browser"
import NativeWantedEntries from "@/components/native-wanted-entries"
import { useBinderHistory } from "@/hooks/use-binder-history"
import { nativeConsumerFixture } from "@/tests/fixtures/native-card-consumers"
import { inventoryProjectionCatalog } from "@/tests/fixtures/inventory-browse"
import type { NativeConsumerBinding } from "@/lib/collection/native-card-consumers"
import type { StagedSlotCommandIntent } from "@/lib/binder-slot-editing"

/** Actual consumers with a synthetic read/admission and draft sink. No BrowserSession/IDB/HTTP acceptance. */
export default function NativeCardConsumersHarness() {
  const [binding, setBinding] = useState<NativeConsumerBinding | null>(null)
  const [usd, setUsd] = useState(false)
  const [mode, setMode] = useState("show")
  const [priceCase, setPriceCase] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<StagedSlotCommandIntent[]>([])
  const [legacyWrites, setLegacyWrites] = useState(0)
  const live = useRef<NativeConsumerBinding | null>(null)
  const history = useBinderHistory(null)
  useEffect(() => { let active = true; void nativeConsumerFixture(new URLSearchParams(window.location.search).has("unknown")).then(({ binding }) => { if (active) {
    const params = new URLSearchParams(window.location.search)
    setMode(params.get("mode") ?? "show")
    setPriceCase(params.get("priceCase"))
    if (params.has("cached") && binding.read.evidence.kind !== "unavailable") binding = { ...binding, editingAvailable: false, read: { ...binding.read, evidence: { kind: "cached", snapshot: binding.read.evidence.snapshot } } }
    if (params.has("selected") && binding.read.evidence.kind !== "unavailable") binding.collectionId = binding.read.evidence.snapshot.collections[0].id
    if (params.has("denied")) binding.admit = () => null
    if (params.has("unavailable")) binding = { ...binding, editingAvailable: false, read: { ...binding.read, evidence: { kind: "unavailable" } } }
    setBinding(binding)
  } }); return () => { active = false } }, [])
  useLayoutEffect(() => { live.current = binding }, [binding])
  if (!binding) return null
  const current: NativeConsumerBinding = { ...binding, admit: () => {
    const b = live.current
    if (!b?.editingAvailable || b.read.evidence.kind !== "complete" || !navigator.onLine) return null
    const admission = b.admit()
    return admission ? { ...admission, read: b.read, scope: b.scope, receive: draft => { setDrafts(d => [...d, draft]) } } : null
  } }
  const noop = () => {}
  const legacy = async () => { setLegacyWrites(n => n + 1) }
  const card = { ...inventoryProjectionCatalog[1].card, dexIds: [], variants: { normal: true }, ...(priceCase === "unknown-language" ? { language: undefined } : {}) }
  return <main className="flex h-dvh flex-col overflow-hidden pt-[var(--top-inset)] pb-[var(--dock-clearance)]">
    <div className="z-50 flex shrink-0 flex-wrap gap-1 bg-background p-1" aria-label="Synthetic harness controls">
      {["show", "search", "browser", "details", "wanted"].map(value => <button className="min-h-9 rounded border px-2 text-xs" key={value} onClick={() => setMode(value)}>{value}</button>)}
      <button className="min-h-9 rounded border px-2 text-xs" onClick={() => setUsd(value => !value)}>Toggle currency</button>
      <button className="min-h-9 rounded border px-2 text-xs" onClick={() => setBinding({ ...binding, collectionId: binding.collectionId ? undefined : binding.read.evidence.kind !== "unavailable" ? binding.read.evidence.snapshot.collections[0].id : undefined })}>Toggle scope</button>
      <button className="min-h-9 rounded border px-2 text-xs" onClick={() => binding.read.evidence.kind !== "unavailable" && setBinding({ ...binding, editingAvailable: false, read: { ...binding.read, evidence: { kind: "cached", snapshot: binding.read.evidence.snapshot } } })}>Cached read</button>
      <button className="min-h-9 rounded border px-2 text-xs" onClick={() => { live.current = null; setBinding({ ...binding, admit: () => null }) }}>Deny admission</button>
    </div>
    <output aria-label="Synthetic draft count" className="sr-only">{drafts.length}</output>
    <output aria-label="Synthetic latest draft" className="sr-only">{JSON.stringify(drafts.at(-1) ?? null)}</output>
    <output aria-label="Synthetic legacy writes" className="sr-only">{legacyWrites}</output>
    {mode === "wanted" && <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><NativeWantedEntries presentation="wanted" binding={current} onCheck={noop} /></div>}
    {mode === "check" && <QuickCardCheck nativeConsumer={current} card={card} pokemon={{ id: 0, name: "Synthetic card" }} state={{ owned: false, wanted: false }} currency="GBP" pricingRegion="UK" isOnline={true} readOnly initialFinish={priceCase === "unsupported-finish" ? "ultra_rare" : "normal"} onBack={noop} onOpenDetails={noop} onAction={legacy} isInBundle={() => false} onAddToBundle={noop} />}
    {mode === "show" && <QuickMode nativeConsumer={current} history={history} onClose={() => setMode("closed")} onNavigate={noop} onSelectPokemon={noop} onSelectCard={noop} onBrowseIllustrator={noop} getOfflineCards={async () => inventoryProjectionCatalog.map(c => ({ ...c.card, dexIds: [...c.pokemonIds ?? []] }))} isOnline={true} cardCheck={{ currency: usd ? "USD" : "GBP", fxRates: { date: "2026-11-10", eurToGbp: 0.9, usdToGbp: 0.8 }, getCardState: () => ({ owned: false, wanted: false }), onAction: legacy, huntItems: [] }} />}
    {mode === "search" && <div className="min-h-0 flex-1 overflow-auto p-3"><PokemonSearch nativeConsumer={current} history={history} onSelect={noop} onBrowseCards={noop} getOfflineCards={async () => inventoryProjectionCatalog.map(c => ({ ...c.card, dexIds: [...c.pokemonIds ?? []] }))} /></div>}
    {(mode === "browser" || mode === "details") && <PokemonCardsBrowser nativeConsumer={current} pokemon={mode === "details" ? null : { id: 143, name: "snorlax" }} isDesktop={false} onClose={noop} onAddCard={() => { void legacy() }} onWantCard={() => { void legacy() }} formatPrice={() => null} cardDetails={mode === "details" ? { card, finish: priceCase === "unsupported-finish" ? "ultra_rare" : "normal", getState: () => ({ owned: false, wanted: false }), onAction: legacy, onRemoveOwned: () => { void legacy() }, onJumpToSlot: noop } : undefined} />}
  </main>
}
