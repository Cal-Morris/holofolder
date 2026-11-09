"use client"

import { useCallback, useState } from "react"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { CARD_PICKER_LANGUAGES } from "@/lib/card-picker-filters"
import { useCardSearch } from "@/hooks/use-card-search"
import { buildOfflineCardIndex } from "@/lib/offline-card-index"
import { useCardPrices, getCardPriceKey } from "@/hooks/use-card-prices"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import { isCardLanguage, type CardFinish, type CardLanguage } from "@/lib/domain/cards"
import type { SlotTarget } from "@/lib/domain/binder-slots"
import type { InventoryCatalogResolver, InventorySnapshot } from "@/lib/domain/inventory"
import type { SelectedWant } from "@/lib/domain/inventory-commands"
import { pickerCandidate, pickerChoices, pickerFinishes, prepareSlotPickerIntent, type SlotPickerAction, type SlotPickerIntent, type SlotPickerScope } from "@/lib/slot-picker"
import { getPokemonSummary, POKEMON_CATALOG } from "@/lib/pokemon-catalog"

import { useSlotDraftAcceptance } from "@/hooks/use-slot-draft-acceptance"
import type { SlotCommandSink } from "@/lib/binder-slot-editing"

export interface SlotPickerBoundary {
  snapshot: InventorySnapshot
  scope: SlotPickerScope
  catalog: InventoryCatalogResolver
  onCommandIntent: SlotCommandSink
  localDurable?: boolean
}
const button = "min-h-10 rounded-xl border border-border px-3 py-2 text-left text-sm active:scale-[0.98] disabled:opacity-50"

/** Content of the shared slot-detail sheet, not another overlay or an ownership store. */
export default function SlotPicker({ boundary }: { boundary: SlotPickerBoundary }) {
  const { snapshot, scope, catalog, onCommandIntent } = boundary
  const slot = snapshot.binders.find(b => b.collectionId === scope.collectionId)!.slots.find(s => s.id === scope.slotId)!
  const [mode, setMode] = useState<"actions" | "assign" | "target">("actions")
  const [query, setQuery] = useState("")
  const [card, setCard] = useState<SearchCardResult | null>(null)
  const [finish, setFinish] = useState<CardFinish | undefined>()
  const [want, setWant] = useState<SelectedWant>(null)
  const [error, setError] = useState<string | null>(null)
  const [language, setLanguage] = useState<CardLanguage>("en")
  const offlineCards = useCallback(() => buildOfflineCardIndex([]), [])
  const search = useCardSearch(query, mode !== "actions" && !card, offlineCards, { language, includeNonPokemon: true })
  const { pricesByCardId, isLoading: loadingPrices } = useCardPrices((card ? [card] : search.cards).filter(c => isCardLanguage(c.language)).map(c => ({ cardId: c.id, language: c.language! })), mode !== "actions")
  const quotesFor = (c: SearchCardResult) => isCardLanguage(c.language) ? pricesByCardId[getCardPriceKey(c.id, c.language)]?.finishPrices : undefined
  const resolve: InventoryCatalogResolver = id => card && matchesCatalogCardId(card, id) ? pickerCandidate(card) : catalog(id)
  const reset = () => { setMode("actions"); setCard(null); setQuery(""); setWant(null); setError(null) }
  const { pending, busy, message, handoff } = useSlotDraftAcceptance<SlotPickerIntent>(onCommandIntent, reset)
  const emit = (action: SlotPickerAction, resolver = resolve) => {
    if (pending || busy) return
    try {
      const prepared = prepareSlotPickerIntent(snapshot, scope, action, { source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() }, resolver)
      const draft = { scope: prepared.scope, intent: prepared.intent }
      handoff(draft)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "unavailable"
      setError(reason === "occupied-target" ? "This target does not match the owned copy. Cancel to keep everything, or clear contents first to leave the copy Unassigned."
        : reason === "target-mismatch" ? "This card does not match this slot’s target. Choose a compatible card or cancel."
        : "Draft could not be handed off. Nothing is confirmed. Cancel or retry the same draft.")
    }
  }
  const target = (value: SlotTarget) => emit({ kind: "target", target: value })
  const chooseCard = (selected: SearchCardResult) => {
    const candidate = pickerCandidate(selected)
    const selectedResolver: InventoryCatalogResolver = id => matchesCatalogCardId(selected, id) ? candidate : catalog(id)
    setCard(selected); setFinish(undefined); setError(null)
    const options = pickerFinishes(selected, quotesFor(selected))
    const identity = { kind: "card" as const, cardId: selected.canonicalId ?? selected.id, ...(isCardLanguage(selected.language) ? { language: selected.language } : {}), ...(options.length === 1 ? { finish: options[0].finish } : {}) }
    const copies = pickerChoices(snapshot, identity, selectedResolver)
    if (mode === "assign" && options.length <= 1 && !copies.some(c => c.label !== "Raw")) {
      emit({ kind: "assign", selection: copies[0]?.selection ?? { kind: "catalog", identity, newItemId: crypto.randomUUID() }, fulfillWant: want }, selectedResolver)
    }
  }
  const finishes = card ? pickerFinishes(card, quotesFor(card)) : []
  const selectedFinish = finish ?? (finishes.length === 1 ? finishes[0].finish : undefined)
  const identity = card ? { kind: "card" as const, cardId: card.canonicalId ?? card.id, ...(isCardLanguage(card.language) ? { language: card.language } : {}), ...(selectedFinish ? { finish: selectedFinish } : {}) } : null
  const choices = identity ? pickerChoices(snapshot, identity, resolve) : []
  const hasGrade = choices.some(c => c.label !== "Raw")
  const ready = finishes.length < 2 || finish !== undefined
  const selectRaw = (selectedIdentity = identity!) => emit({ kind: "assign", selection: pickerChoices(snapshot, selectedIdentity, resolve).find(c => c.label === "Raw")?.selection ?? { kind: "catalog", identity: selectedIdentity, newItemId: crypto.randomUUID() }, fulfillWant: want })
  const placed = identity ? snapshot.placements.filter(p => {
    const item = snapshot.items.find(i => i.id === p.inventoryItemId)
    if (!item || item.identity.kind !== "card") return false
    const match = resolve(item.identity.cardId), current = resolve(identity.cardId)
    return match && current && (match.canonicalId ?? match.id) === (current.canonicalId ?? current.id)
  }) : []
  return <div className="space-y-3" data-slot-picker>
    <p className="text-xs text-muted-foreground">{boundary.localDurable ? "Changes are saved on this device only after acceptance. Sync is separate." : "Internal draft only. Changes are not saved or synced."}</p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {message && <p role={pending ? "alert" : "status"} className="break-words text-sm">{message}</p>}
    {busy && <p role="status">Saving on device…</p>}
    {pending && <button className={button} disabled={busy} onClick={() => handoff(pending)}>Retry draft</button>}
    <fieldset disabled={pending !== null || busy} className="min-w-0 space-y-3">
    {mode === "actions" ? <div className="grid gap-2">
      {!slot.inventoryItemId && <button className={button} onClick={() => setMode("assign")}>Choose card</button>}
      <button className={button} onClick={() => setMode("target")}>{slot.target ? "Change target" : "Set target"}</button>
      {slot.target && <button className={button} onClick={() => emit({ kind: "target", target: null })}>Remove target</button>}
      {slot.inventoryItemId && <><button className={button} onClick={() => emit({ kind: "clear" })}>Clear contents</button><p className="text-xs text-muted-foreground">Keeps this slot and target. The owned copy becomes Unassigned.</p></>}
      {!slot.inventoryItemId && slot.wantedCards.map((w, index) => <button key={index} className={button} onClick={() => { setWant({ index, expected: w }); setQuery(w.card_id); setMode("assign") }}>Fulfill want {index + 1}: {w.card_name}</button>)}
    </div> : <>
      <button className={button} onClick={reset}>Cancel</button>
      <h3 className="font-semibold">{mode === "target" ? "Choose target" : "Choose card for this slot"}</h3>
      {!card ? <>
        <label className="block text-sm">Catalog language<select aria-label="Catalog language" value={language} onChange={e => { setLanguage(e.target.value as CardLanguage); setError(null) }} className="ml-2 min-h-10 max-w-full rounded-xl border border-border bg-background px-2 text-base">{CARD_PICKER_LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
        <label className="block text-sm">Search catalog<input aria-label="Search slot catalog" value={query} onChange={e => setQuery(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base" /></label>
        {search.offline && <p role="status" className="text-sm text-muted-foreground">Searching cached cards on this device only. Uncached catalog coverage is unavailable offline.</p>}
        {search.loading && <p role="status">Searching…</p>}
        {!search.loading && query.length >= 2 && !search.cards.length && <p>No matching cached or available catalog cards.</p>}
        {mode === "target" && <div className="grid gap-2" aria-label="Pokémon targets">{POKEMON_CATALOG.filter(p => query.length >= 2 && (p.name.includes(query.toLowerCase()) || String(p.id) === query)).slice(0, 8).map(p => <button key={p.id} className={button} onClick={() => target({ kind: "pokemon", pokemonId: p.id })}>Target Pokémon: {getPokemonSummary(p.id)?.name ?? p.name}</button>)}</div>}
        <div className="grid gap-2">{search.cards.map(c => <button className={`${button} break-words [overflow-wrap:anywhere]`} key={`${c.id}:${c.language ?? "unknown"}`} disabled={loadingPrices} onClick={() => chooseCard(c)}>{c.name} · {c.set.name} · {c.localId} · {c.language ?? "Unknown language"}</button>)}</div>
      </> : <div className="space-y-3">
        <button className={button} onClick={() => { setCard(null); setError(null) }}>Back to cards</button>
        <p className="break-words [overflow-wrap:anywhere]">{card.name} · {card.set.name} · {identity?.language ?? "Unknown language"}</p>
        {finishes.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label="Card finish">{finishes.map(f => <button key={f.finish} className={button} aria-pressed={finish === f.finish} onClick={() => { setFinish(f.finish); const selectedIdentity = { ...identity!, finish: f.finish }; if (mode === "assign" && !pickerChoices(snapshot, selectedIdentity, resolve).some(c => c.label !== "Raw")) selectRaw(selectedIdentity) }}>{f.label}</button>)}</div>}
        {!selectedFinish && <p>Unknown finish</p>}
        {mode === "target" ? <button className={button} disabled={!ready} onClick={() => target(identity!)}>Set printing target</button> : <div className="grid gap-2">
          {choices.length ? choices.map((c, index) => <button className={button} key={index} disabled={!ready} onClick={() => emit({ kind: "assign", selection: c.selection, fulfillWant: want })}>Select {c.label}{choices.filter(other => other.label === c.label).length > 1 ? `, copy group ${index + 1}` : ""}</button>) : <button className={button} disabled={!ready} onClick={() => emit({ kind: "assign", selection: { kind: "catalog", identity: identity!, newItemId: crypto.randomUUID() }, fulfillWant: want })}>Select Raw</button>}
          {hasGrade && !choices.some(c => c.label === "Raw") && <p className="text-xs text-muted-foreground">Only recorded graded copies are available. Adding a separate Raw copy here needs the forthcoming authenticated command integration.</p>}
        </div>}
        {placed.length > 0 && <p className="text-xs text-muted-foreground">Already placed in {placed.map(p => snapshot.collections.find(c => c.id === p.collectionId)?.name ?? "another collection").join(", ")}. These copies stay where they are.</p>}
      </div>}
    </>}
    </fieldset>
  </div>
}
