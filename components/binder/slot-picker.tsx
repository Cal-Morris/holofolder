"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import SlotCatalogSearch from "./slot-catalog-search"
import { useCardSearch } from "@/hooks/use-card-search"
import { buildOfflineCardIndex } from "@/lib/offline-card-index"
import { useCardPrices, getCardPriceKey } from "@/hooks/use-card-prices"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import { isCardLanguage, type CardFinish, type CardLanguage } from "@/lib/domain/cards"
import type { SlotTarget } from "@/lib/domain/binder-slots"
import type { InventoryCatalogResolver, InventorySnapshot } from "@/lib/domain/inventory"
import type { SelectedWant } from "@/lib/domain/inventory-commands"
import { matchingWantIndexes, pickerCandidate, pickerChoices, pickerFinishes, prepareSlotPickerIntent, type SlotPickerAction, type SlotPickerIntent, type SlotPickerScope } from "@/lib/slot-picker"
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
/**
 * How the sheet was reached. "assign" opens card search directly (no species list to show), "edit" is the
 * structural target controls, and `chosen` is a pick already made in the species card selector.
 */
export interface SlotPickerFlow { entry: "assign" | "edit"; chosen?: { card: SearchCardResult; finish?: CardFinish }; onBack?: () => void }
const button = "min-h-10 rounded-xl border border-border px-3 py-2 text-left text-sm active:scale-[0.98] disabled:opacity-50"

/** Content of the shared slot-detail sheet, not another overlay or an ownership store. */
export default function SlotPicker({ boundary, flow, onCancel }: { boundary: SlotPickerBoundary; flow?: SlotPickerFlow; onCancel?: () => void }) {
  const { snapshot, scope, catalog, onCommandIntent } = boundary
  const slot = snapshot.binders.find(b => b.collectionId === scope.collectionId)!.slots.find(s => s.id === scope.slotId)!
  const chosen = flow?.chosen
  const [mode, setMode] = useState<"actions" | "assign" | "target">(flow?.entry === "assign" || chosen ? "assign" : "actions")
  const [query, setQuery] = useState("")
  const [card, setCard] = useState<SearchCardResult | null>(chosen?.card ?? null)
  const [finish, setFinish] = useState<CardFinish | undefined>(chosen?.finish)
  const [editing, setEditing] = useState(flow?.entry === "edit")
  const [want, setWant] = useState<SelectedWant>(null)
  const [error, setError] = useState<string | null>(null)
  const [language, setLanguage] = useState<CardLanguage>("en")
  const offlineCards = useCallback(() => buildOfflineCardIndex([]), [])
  const search = useCardSearch(query, mode !== "actions" && !card, offlineCards, { language, includeNonPokemon: true })
  const { pricesByCardId, isLoading: loadingPrices } = useCardPrices((card ? [card] : search.cards).filter(c => isCardLanguage(c.language)).map(c => ({ cardId: c.id, language: c.language! })), mode !== "actions")
  const quotesFor = (c: SearchCardResult) => isCardLanguage(c.language) ? pricesByCardId[getCardPriceKey(c.id, c.language)]?.finishPrices : undefined
  const resolve: InventoryCatalogResolver = id => card && matchesCatalogCardId(card, id) ? pickerCandidate(card) : catalog(id)
  const reset = () => { setMode("actions"); setCard(null); setQuery(""); setWant(null); setError(null) }
  const { pending, busy, message, handoff } = useSlotDraftAcceptance<SlotPickerIntent>(onCommandIntent, () => { reset(); setEditing(false) })
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
  /** A want this exact card could fulfil is always an explicit choice, so it never saves on the first tap. */
  const mayAutoAssign = (selected: SearchCardResult, selectedFinish: CardFinish | undefined) => slot.inventoryItemId !== null || matchingWantIndexes(slot.wantedCards, selected, selectedFinish).length === 0
  const chooseCard = (selected: SearchCardResult) => {
    const candidate = pickerCandidate(selected)
    const selectedResolver: InventoryCatalogResolver = id => matchesCatalogCardId(selected, id) ? candidate : catalog(id)
    setCard(selected); setFinish(undefined); setError(null)
    const options = pickerFinishes(selected, quotesFor(selected))
    const identity = { kind: "card" as const, cardId: selected.canonicalId ?? selected.id, ...(isCardLanguage(selected.language) ? { language: selected.language } : {}), ...(options.length === 1 ? { finish: options[0].finish } : {}) }
    const copies = pickerChoices(snapshot, identity, selectedResolver)
    if (mode === "assign" && options.length <= 1 && !copies.some(c => c.label !== "Raw") && mayAutoAssign(selected, identity.finish)) {
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
  const wantsHere = mode === "assign" && !slot.inventoryItemId && card ? matchingWantIndexes(slot.wantedCards, card, selectedFinish) : []
  // A selector pick follows the search pick's rule: it saves at once only when the finish is settled (chosen in the selector, or the
  // card has at most one) and no graded copy or matching want needs an explicit choice. Otherwise the card step below asks.
  const autoAssigned = useRef(false)
  const autoAssign = () => {
    if (autoAssigned.current || !chosen) return
    autoAssigned.current = true
    if (ready && identity && !hasGrade && mayAutoAssign(chosen.card, selectedFinish)) selectRaw(identity)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { queueMicrotask(autoAssign) }, [])
  return <div className="space-y-3" data-slot-picker>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {message && <p role={pending ? "alert" : "status"} className="break-words text-sm">{message}</p>}
    {busy && <p role="status">Saving on device…</p>}
    {pending && <button className={button} disabled={busy} onClick={() => handoff(pending)}>Retry draft</button>}
    <fieldset disabled={pending !== null || busy} className="min-w-0 space-y-3">
    {mode === "actions" ? <div className="grid gap-2">
      <details className="rounded-xl border border-border px-3" open={editing || undefined}><summary className="min-h-10 cursor-pointer py-2 text-sm font-medium">Edit slot</summary><div className="grid gap-2 pb-3">
      <button className={button} onClick={() => setMode("target")}>{slot.target ? "Change target" : "Set target"}</button>
      {slot.target && <button className={button} onClick={() => emit({ kind: "target", target: null })}>Remove target</button>}
      {slot.inventoryItemId && <><button className={button} onClick={() => emit({ kind: "clear" })}>Move card to Unassigned</button><p className="text-xs text-muted-foreground">Keeps your card in your collection and leaves this slot empty.</p></>}
      </div></details>
    </div> : <>
      <div className="flex flex-wrap gap-2">
        <button className={button} onClick={flow?.entry === "assign" || chosen ? onCancel : reset}>Cancel</button>
        {flow?.entry === "assign" && !chosen && !card && mode === "assign" && <button className={button} onClick={() => { setEditing(true); setMode("actions") }}>Edit slot</button>}
      </div>
      <h3 className="font-semibold">{mode === "target" ? "Choose target" : "Choose card for this slot"}</h3>
      {!card ? <>
        <SlotCatalogSearch query={query} language={language} cards={search.cards} loading={search.loading} offline={search.offline} disabled={loadingPrices}
          onQuery={setQuery} onLanguage={value => { setLanguage(value); setError(null) }} onSelect={chooseCard} />
        {mode === "target" && <div className="grid gap-2" aria-label="Pokémon targets">{POKEMON_CATALOG.filter(p => query.length >= 2 && (p.name.includes(query.toLowerCase()) || String(p.id) === query)).slice(0, 8).map(p => <button key={p.id} className={button} onClick={() => target({ kind: "pokemon", pokemonId: p.id })}>Target Pokémon: {getPokemonSummary(p.id)?.name ?? p.name}</button>)}</div>}

      </> : <div className="space-y-3">
        <button className={button} onClick={() => { if (chosen && flow?.onBack) { flow.onBack(); return } setCard(null); setWant(null); setError(null) }}>Back to cards</button>
        <p className="break-words [overflow-wrap:anywhere]">{card.name} · {card.set.name} · {identity?.language ?? "Unknown language"}</p>
        {finishes.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label="Card finish">{finishes.map(f => <button key={f.finish} className={button} aria-pressed={finish === f.finish} onClick={() => { setFinish(f.finish); const selectedIdentity = { ...identity!, finish: f.finish }; if (mode === "assign" && !pickerChoices(snapshot, selectedIdentity, resolve).some(c => c.label !== "Raw") && mayAutoAssign(card, f.finish)) selectRaw(selectedIdentity) }}>{f.label}</button>)}</div>}
        {!selectedFinish && <p>Unknown finish</p>}
        {wantsHere.length > 0 && <div className="flex flex-wrap gap-2" role="group" aria-label="Fulfill a want">{wantsHere.map(index => <button key={index} className={button} aria-pressed={want?.index === index} onClick={() => setWant(want?.index === index ? null : { index, expected: slot.wantedCards[index] })}>Fulfill want {index + 1}: {slot.wantedCards[index].card_name}</button>)}</div>}
        {mode === "target" ? <button className={button} disabled={!ready} onClick={() => target(identity!)}>Set printing target</button> : <div className="grid gap-2">
          {choices.length ? choices.map((c, index) => <button className={button} key={index} disabled={!ready} onClick={() => emit({ kind: "assign", selection: c.selection, fulfillWant: want })}>Select {c.label}{choices.filter(other => other.label === c.label).length > 1 ? `, copy group ${index + 1}` : ""}</button>) : <button className={button} disabled={!ready} onClick={() => emit({ kind: "assign", selection: { kind: "catalog", identity: identity!, newItemId: crypto.randomUUID() }, fulfillWant: want })}>Select Raw</button>}
          {hasGrade && !choices.some(c => c.label === "Raw") && <p className="text-xs text-muted-foreground">Only your recorded graded copies are available here.</p>}
        </div>}
        {placed.length > 0 && <p className="text-xs text-muted-foreground">Already placed in {placed.map(p => snapshot.collections.find(c => c.id === p.collectionId)?.name ?? "another collection").join(", ")}. These copies stay where they are.</p>}
      </div>}
    </>}
    </fieldset>
  </div>
}
