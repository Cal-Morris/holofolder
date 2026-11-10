"use client"

import { useCallback, useState } from "react"
import SlotCatalogSearch from "./slot-catalog-search"
import NativePickQuestion from "./native-pick-question"
import CardPickerVariantSheet from "@/components/card-picker-variant-sheet"
import { useCardSearch } from "@/hooks/use-card-search"
import { buildOfflineCardIndex } from "@/lib/offline-card-index"
import { useCardPrices, getCardPriceKey } from "@/hooks/use-card-prices"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import { isCardLanguage, type CardFinish, type CardLanguage } from "@/lib/domain/cards"
import type { SlotTarget } from "@/lib/domain/binder-slots"
import type { InventoryCatalogResolver, InventorySnapshot } from "@/lib/domain/inventory"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { pickerCandidate, pickerFinishes, prepareSlotPickerIntent, type SlotPickerAction, type SlotPickerIntent, type SlotPickerScope } from "@/lib/slot-picker"
import type { CardPickerStandardFinish } from "@/lib/card-picker-filters"
import { getPokemonSummary, POKEMON_CATALOG } from "@/lib/pokemon-catalog"
import { useSlotDraftAcceptance } from "@/hooks/use-slot-draft-acceptance"
import { useNativeSlotPick } from "@/hooks/use-native-slot-pick"
import { slotDraftFailureMessage } from "@/lib/slot-draft-failure"
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
export default function SlotPicker({ boundary, choosing, structural, onDone }: { boundary: SlotPickerBoundary; choosing?: boolean; structural?: boolean; onDone?: () => void }) {
  return choosing ? <CardSearch boundary={boundary} onSaved={onDone ?? (() => {})} /> : <SlotEdits boundary={boundary} structural={structural} />
}

/** Normal choosing for a free or printing pocket: catalog search, then the picker's own variant/copy sheets and a headless save. */
function CardSearch({ boundary, onSaved }: { boundary: SlotPickerBoundary; onSaved: () => void }) {
  const [query, setQuery] = useState("")
  const [language, setLanguage] = useState<CardLanguage>("en")
  const [variant, setVariant] = useState<SearchCardResult | null>(null)
  const save = useNativeSlotPick(boundary, onSaved)
  const offlineCards = useCallback(() => buildOfflineCardIndex([]), [])
  const search = useCardSearch(query, true, offlineCards, { language, includeNonPokemon: true })
  const { pricesByCardId, isLoading: loadingPrices } = useCardPrices(search.cards.filter(c => isCardLanguage(c.language)).map(c => ({ cardId: c.id, language: c.language! })), true)
  const quotesFor = (c: SearchCardResult) => isCardLanguage(c.language) ? pricesByCardId[getCardPriceKey(c.id, c.language)]?.finishPrices : undefined
  const choose = (card: SearchCardResult) => {
    if (save.busy) return
    if (pickerFinishes(card, quotesFor(card)).length > 1) setVariant(card)
    else save.pick(card, undefined)
  }
  return <>
    <SlotCatalogSearch query={query} language={language} cards={search.cards} loading={search.loading} offline={search.offline} disabled={loadingPrices || save.busy}
      onQuery={setQuery} onLanguage={setLanguage} onSelect={choose} />
    {variant && <CardPickerVariantSheet cardName={variant.name} setName={variant.set.name} actionLabel="Add" suggested={null}
      choices={pickerFinishes(variant, quotesFor(variant)).map(f => ({ finish: f.finish as CardPickerStandardFinish, label: f.label, price: null }))}
      onChoose={finish => { const card = variant; setVariant(null); save.pick(card, finish) }} onClose={() => setVariant(null)} />}
    {save.question && <NativePickQuestion question={save.question} onClose={save.dismiss} />}
  </>
}

/** Owned-copy and layout edits. Target changes are structural, so they only appear in deliberate layout editing. */
function SlotEdits({ boundary, structural }: { boundary: SlotPickerBoundary; structural?: boolean }) {
  const { snapshot, scope, catalog, onCommandIntent } = boundary
  const slot = snapshot.binders.find(b => b.collectionId === scope.collectionId)!.slots.find(s => s.id === scope.slotId)!
  const [targeting, setTargeting] = useState(false)
  const [query, setQuery] = useState("")
  const [card, setCard] = useState<SearchCardResult | null>(null)
  const [finish, setFinish] = useState<CardFinish | undefined>()
  const [language, setLanguage] = useState<CardLanguage>("en")
  const [error, setError] = useState<string | null>(null)
  const offlineCards = useCallback(() => buildOfflineCardIndex([]), [])
  const search = useCardSearch(query, targeting && !card, offlineCards, { language, includeNonPokemon: true })
  const reset = () => { setTargeting(false); setCard(null); setQuery(""); setError(null) }
  const { pending, busy, message, handoff, retry } = useSlotDraftAcceptance<SlotPickerIntent>(onCommandIntent, reset)
  const emit = (action: SlotPickerAction) => {
    if (pending || busy) return
    // A printing target picked from the catalog may not be in the read catalog yet; its evidence travels with the draft.
    const resolver: InventoryCatalogResolver = card ? (candidate => (id: string) => matchesCatalogCardId(card, id) ? candidate : catalog(id))(pickerCandidate(card)) : catalog
    try {
      const prepared = prepareSlotPickerIntent(snapshot, scope, action, { source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() }, resolver)
      handoff({ scope: prepared.scope, intent: prepared.intent }, resolver)
    } catch (cause) { setError(slotDraftFailureMessage(cause)) }
  }
  const target = (value: SlotTarget | null) => emit({ kind: "target", target: value })
  const finishes = card ? pickerFinishes(card) : []
  const selectedFinish = finish ?? (finishes.length === 1 ? finishes[0].finish : undefined)
  if (!structural && !slot.inventoryItemId && !message && !pending && !error) return null
  const clear = <><button className={button} onClick={() => emit({ kind: "clear" })}>Move card to Unassigned</button><p className="text-xs text-muted-foreground">Keeps your card in your collection and leaves this slot empty.</p></>
  return <div className="space-y-3" data-slot-picker>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {message && <p role={pending ? "alert" : "status"} className="break-words text-sm">{message}</p>}
    {pending && <button className={button} disabled={busy} onClick={retry}>Try again</button>}
    <fieldset disabled={pending !== null || busy} className="min-w-0 space-y-3">
    {!targeting ? <div className="grid gap-2">
      {structural && <button className={button} onClick={() => setTargeting(true)}>{slot.target ? "Change target" : "Set target"}</button>}
      {structural && slot.target && <button className={button} onClick={() => target(null)}>Remove target</button>}
      {slot.inventoryItemId && (structural ? clear : <details className="rounded-xl border border-border px-3"><summary className="min-h-10 cursor-pointer py-2 text-sm font-medium">Card options</summary><div className="grid gap-2 pb-3">{clear}</div></details>)}
    </div> : <>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={reset}>Cancel</button></div>
      <h3 className="font-semibold">Choose target</h3>
      {!card ? <>
        <SlotCatalogSearch query={query} language={language} cards={search.cards} loading={search.loading} offline={search.offline}
          onQuery={setQuery} onLanguage={value => { setLanguage(value); setError(null) }} onSelect={c => { setCard(c); setFinish(undefined) }} />
        <div className="grid gap-2" aria-label="Pokémon targets">{POKEMON_CATALOG.filter(p => query.length >= 2 && (p.name.includes(query.toLowerCase()) || String(p.id) === query)).slice(0, 8).map(p => <button key={p.id} className={button} onClick={() => target({ kind: "pokemon", pokemonId: p.id })}>Target Pokémon: {getPokemonSummary(p.id)?.name ?? p.name}</button>)}</div>
      </> : <div className="space-y-3">
        <button className={button} onClick={() => { setCard(null); setError(null) }}>Back to cards</button>
        <p className="break-words [overflow-wrap:anywhere]">{card.name} · {card.set.name} · {isCardLanguage(card.language) ? card.language : "Unknown language"}</p>
        {finishes.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label="Card finish">{finishes.map(f => <button key={f.finish} className={button} aria-pressed={finish === f.finish} onClick={() => setFinish(f.finish)}>{f.label}</button>)}</div>}
        <button className={button} disabled={finishes.length > 1 && !finish} onClick={() => target({ kind: "card", cardId: card.canonicalId ?? card.id, ...(isCardLanguage(card.language) ? { language: card.language } : {}), ...(selectedFinish ? { finish: selectedFinish } : {}) })}>Set printing target</button>
      </div>}
    </>}
    </fieldset>
  </div>
}
