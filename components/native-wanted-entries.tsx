"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Share2 } from "lucide-react"
import { ListClearButton, ListControls, ListFiltersButton, ListSearch, ListSelect } from "@/components/list-controls"
import { getCardPriceKey, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import { useInventoryPriceState } from "@/hooks/use-inventory-prices"
import { applyPriceStaleness } from "@/lib/price-freshness"
import { isCardLanguage } from "@/lib/domain/cards"
import { getPokemonSummary } from "@/lib/pokemon-catalog"
import type { PricingRegion } from "@/lib/pricing-region"
import { regionalizeCardPrices } from "@/lib/regional-price"
import { applyWantedFilters, buildWantedDashboardSummary, countWantedFilters, countWantedPriceDrops, EMPTY_WANTED_FILTERS, filterWantedDashboardEntries, readRememberedWantedView,
  sortWantedDashboardEntries, wantedCompletionTotal, WANTED_SORTS, WANTED_VIEW_STORAGE_KEY, type WantedDashboardCard, type WantedDashboardSort } from "@/lib/wanted-dashboard"
import { getRisingMomentum } from "@/lib/price-momentum"

const WantedFiltersSheet = dynamic(() => import("@/components/wanted-filters-sheet"), { ssr: false })
const gbp = (amount: number | null | undefined) => typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? `£${amount.toFixed(2)}` : null
import { nativeCardConsumers, nativeWantSelections, prepareNativeWant, type NativeConsumerBinding } from "@/lib/collection/native-card-consumers"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { toCardImageSrc } from "@/lib/card-image-url"
import { formatCardFinishLabel, formatCardLanguageLabel } from "@/lib/card-labels"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import type { CardFinish } from "@/lib/domain/cards"

/** Explicit wanted entries, not species groups or a second inventory store. Used by Wanted, Hunting and card details. */
export default function NativeWantedEntries({ binding, card, finish, onCheck, presentation = "lookup", pricing, onShare }: {
  presentation?: "lookup" | "wanted"
  /** The Wanted tab only: how saved prices are weighted and written for this person. */
  pricing?: { region: PricingRegion; formatAmount: (amount: number | null | undefined, price?: CardPriceSnapshot) => string | null }
  /** The Wanted tab only: share or copy the list as it is currently filtered and sorted. */
  onShare?: (cards: WantedDashboardCard[]) => void
  binding: NativeConsumerBinding
  card?: SearchCardResult
  finish?: CardFinish
  onCheck?: (card: SearchCardResult, finish?: CardFinish) => void
}) {
  const isWanted = presentation === "wanted"
  const model = nativeCardConsumers(binding)
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const entries = model?.wants.filter(w => !card || w.card && matchesCatalogCardId(card, w.card.canonicalId ?? w.card.id)
    && w.card.language === card.language && (!finish || w.finish === finish)) ?? []
  const title = isWanted ? "Wanted cards" : card ? "On your want list" : "Hunting"
  // The Wanted tab: the same search, sort, filters and total as the want list always had, over these entries.
  // Each want keeps its own destination, so two wants for one card stay two rows.
  const [view, setView] = useState(() => isWanted ? readRememberedWantedView() : { sort: "highest" as WantedDashboardSort, filters: EMPTY_WANTED_FILTERS })
  const [search, setSearch] = useState("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  useEffect(() => {
    if (!isWanted) return
    try { window.localStorage.setItem(WANTED_VIEW_STORAGE_KEY, JSON.stringify(view)) } catch { /* Storage full or blocked: the choice still applies for this visit. */ }
  }, [isWanted, view])
  const lookups = isWanted ? [...new Map(entries.flatMap(e => isCardLanguage(e.want.card_language) ? [[getCardPriceKey(e.want.card_id, e.want.card_language), { cardId: e.want.card_id, language: e.want.card_language }] as const] : [])).values()] : []
  // Saved prices only: the want list never asks for a refresh by itself.
  const saved = useInventoryPriceState(lookups)
  const region = pricing?.region ?? "UK"
  const regional = regionalizeCardPrices(Object.fromEntries(saved.prices.map(price => [getCardPriceKey(price.cardId, price.language), { ...price, ...applyPriceStaleness(price, price.fetchedAt) }])), region)
  const summary = buildWantedDashboardSummary(isWanted ? entries.map(e => {
    const dexId = e.card?.dexIds[0] ?? 0
    return { pokemonId: dexId, pokemonName: (dexId ? getPokemonSummary(dexId)?.name : null) ?? e.want.card_name, card: e.want, binderId: e.destination.collectionId, binderName: e.collectionName, nativeKey: e.key }
  }) : [], Object.fromEntries(Object.values(regional).map(price => [`${price.cardId}::${price.language}`, price])))
  const shown = isWanted ? sortWantedDashboardEntries(applyWantedFilters(filterWantedDashboardEntries(summary.cards, search), view.filters), view.sort) : []
  const total = wantedCompletionTotal(summary.cards)
  const activeFilters = countWantedFilters(view.filters)
  const format = pricing?.formatAmount ?? gbp
  const priceOf = new Map(summary.cards.map(c => [(c as WantedDashboardCard & { nativeKey: string }).nativeKey, c]))
  const ordered = isWanted ? shown.flatMap(c => { const entry = entries.find(e => e.key === (c as WantedDashboardCard & { nativeKey: string }).nativeKey); return entry ? [entry] : [] }) : entries
  const noticeEl = notice && <p role="status" className={isWanted ? "sticky top-2 z-10 break-words rounded-xl border border-border/60 bg-card px-3 py-2 text-sm shadow-sm" : "break-words text-sm"}>{notice}</p>
  return <section aria-label={title} className={isWanted ? "mx-auto w-full max-w-6xl space-y-3 p-3 sm:p-4" : "space-y-3 p-3"}>
    {isWanted ? <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Wanted</h1>
          <p className="text-sm text-muted-foreground">{search.trim() || activeFilters ? `${shown.length} of ${entries.length}` : entries.length} wanted {entries.length === 1 ? "card" : "cards"}</p>
          {entries.length > 0 && <p className="text-sm" data-testid="wanted-total">
            {saved.status === "loading" ? <span className="text-muted-foreground">Loading saved prices…</span>
              : total.priced ? <><span className="font-semibold tabular-nums">About {format(total.totalGbp) ?? gbp(total.totalGbp)} to complete</span>{total.unknown > 0 && <span className="text-muted-foreground"> · {total.unknown} without a reliable price</span>}</>
              : <span className="text-muted-foreground">{saved.status === "unavailable" ? "Saved prices couldn't be loaded" : "No reliable saved prices yet"}</span>}
          </p>}
        </div>
        {onShare && entries.length > 0 && <button type="button" onClick={() => onShare(shown)} className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border/60 px-3 text-sm font-medium hover:bg-muted/60"><Share2 className="h-4 w-4" aria-hidden />Share</button>}
      </div>
      {entries.length > 0 && <ListControls>
        <ListSearch label="Search want list" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cards, sets, artists" data-overlay-escape="clear" />
        <ListSelect label="Sort want list" value={view.sort} onChange={e => setView(v => ({ ...v, sort: e.target.value as WantedDashboardSort }))}>
          {WANTED_SORTS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </ListSelect>
        <ListFiltersButton active={activeFilters} aria-haspopup="dialog" onClick={() => setFiltersOpen(true)} data-testid="wanted-sort-filter" />
        {activeFilters > 0 && <ListClearButton onClick={() => setView(v => ({ ...v, filters: EMPTY_WANTED_FILTERS }))} />}
      </ListControls>}
      {filtersOpen && <WantedFiltersSheet sort={view.sort} onSortChange={sort => setView(v => ({ ...v, sort }))} filters={view.filters} onFiltersChange={filters => setView(v => ({ ...v, filters }))}
        priceBands={summary.priceBands} sets={summary.setBreakdown} finishes={summary.finishBreakdown} languages={summary.languageBreakdown}
        risingCount={summary.cards.filter(c => getRisingMomentum(c.price) != null).length} dropCount={countWantedPriceDrops(summary.cards)}
        resultCount={shown.length} onReset={() => setView(v => ({ ...v, filters: EMPTY_WANTED_FILTERS }))} onClose={() => setFiltersOpen(false)} />}
    </> : <h3 className="text-sm font-bold">{title} · {entries.length} {entries.length === 1 ? "card" : "cards"}</h3>}
    {model?.kind === "cached" ? <p className="text-sm text-muted-foreground">Saved wanted cards, read-only while offline.</p> : !model ? <p role="status" className="text-sm text-muted-foreground">Could not load wanted cards. Reconnect and try again.</p> : null}
    {!entries.length && model && <p className="text-sm text-muted-foreground">{card ? "Not on your want list" : "No wanted cards yet"}</p>}
    {isWanted && entries.length > 0 && !ordered.length && <p role="status" className="text-sm text-muted-foreground">No wanted cards match. Try another search or clear the filters.</p>}
    {isWanted && noticeEl}
    {ordered.length > 0 && <div role="list" className={isWanted ? "grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3" : "divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-card/85 dark:divide-white/10 dark:border-white/10 dark:bg-card/70"}>
    {ordered.map(entry => {
      const priced = priceOf.get(entry.key)
      const choices = nativeWantSelections(model, entry.destination)
      const key = JSON.stringify(entry.destination)
      const value = selected[key] ?? ""
      const known = entry.card && entry.finish && entry.card.language
      const artwork = toCardImageSrc(entry.card?.image)
      const snapshot = binding.read.evidence.kind !== "unavailable" ? binding.read.evidence.snapshot : null
      const binder = snapshot?.binders.find(b => b.collectionId === entry.destination.collectionId)
      const index = binder?.slots.findIndex(slot => slot.id === entry.destination.slotId) ?? -1
      const layout = binding.read.layouts.find(l => l.collectionId === entry.destination.collectionId && l.layoutRevision === binder?.layoutRevision)
      const capacity = layout ? layout.rows * layout.cols : null
      const position = index < 0 ? "Position unavailable" : capacity ? `Page ${Math.floor(index / capacity) + 1} · Pocket ${index % capacity + 1}` : `Position ${index + 1}`
      // Only a pocket with several wants needs them told apart.
      const destinationLabel = entries.filter(other => other.destination.slotId === entry.destination.slotId).length > 1 ? `${position} · want ${entry.destination.wantedIndex + 1}` : position
      const art = <span className={`trading-card relative shrink-0 border border-border/55 bg-muted dark:border-white/10 ${isWanted ? "w-12 md:w-[4.5rem]" : "w-11"}`}>
        {artwork && entry.card && <Image src={artwork} alt={entry.card.name} fill sizes={isWanted ? "72px" : "44px"} unoptimized className="object-cover" />}
      </span>
      const details = <>
        <p className={`text-sm font-semibold ${isWanted ? "line-clamp-2 break-words" : "truncate"}`}>{entry.card?.name ?? "Unknown card"}</p>
        <p className="truncate text-xs text-muted-foreground">{[entry.card?.set.name, entry.card?.localId ? `#${entry.card.localId}` : null].filter(Boolean).join(" · ") || "Unknown set"}</p>
        <p className="truncate text-[11px] text-muted-foreground/90">{[entry.finish ? formatCardFinishLabel(entry.finish) : "Unknown finish", entry.card?.language && entry.card.language !== "en" ? formatCardLanguageLabel(entry.card.language) : null].filter(Boolean).join(" · ")}</p>
      </>
      const destination = <p className="break-words text-xs text-muted-foreground">{entry.collectionName} · {destinationLabel}</p>
      const actions = <div className="flex flex-wrap items-center gap-2">
        {isWanted && <span className="min-w-[3.5rem] text-sm font-semibold tabular-nums" data-testid="wanted-price">{priced?.effectiveGbpAmount != null ? format(priced.effectiveGbpAmount, priced.price) ?? gbp(priced.effectiveGbpAmount)
          : saved.status === "loading" ? <span aria-label="Loading price" className="inline-block h-3 w-10 animate-pulse rounded bg-muted align-middle motion-reduce:animate-none" /> : <span className="font-normal text-muted-foreground">No price</span>}</span>}
        {entry.card && onCheck && <button type="button" className="min-h-9 rounded-xl border px-3 text-sm" onClick={() => onCheck(entry.card!, entry.finish ?? undefined)}>Check price</button>}
        {entry.occupied && !isWanted && <p className="text-xs text-muted-foreground">This pocket is occupied. Choose another pocket in your collection.</p>}
        {known && !entry.occupied && model?.kind === "complete" && binding.editingAvailable && <>
          <select aria-label={`Copy for ${destinationLabel}`} className="min-h-9 min-w-36 flex-1 rounded-xl border bg-card px-2 text-sm md:max-w-xs" value={value} disabled={busy} onChange={e => setSelected(s => ({ ...s, [key]: e.target.value }))}>
            <option value="">Choose a copy</option>
            {choices.length ? choices.map((c, index) => <option key={c.selection.inventoryItemId} value={c.selection.inventoryItemId}>Unassigned copy {index + 1}</option>) : <option value="new">New copy</option>}
          </select>
          <button type="button" disabled={!value || busy} className="min-h-9 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50" onClick={async () => {
            if (!entry.card || !entry.finish || !entry.card.language || busy) return
            setBusy(true); setNotice("")
            try {
              const selection = choices.find(c => c.selection.inventoryItemId === value)?.selection
                ?? (value === "new" ? { kind: "catalog" as const, identity: { kind: "card" as const, cardId: entry.card.canonicalId ?? entry.card.id, language: entry.card.language, finish: entry.finish }, newItemId: crypto.randomUUID() } : null)
              if (!selection) throw new Error("Choose an exact copy")
              const prepared = prepareNativeWant(binding, entry.destination, selection)
              const accepted = await prepared.receive(prepared)
              setNotice(accepted?.status === "saved-on-device" ? "Saved on device, awaiting sync" : "Could not confirm this change. Check your collection before trying again.")
            } catch { setNotice("Could not add this card. Your collection may have changed, so check it and try again.") }
            finally { setBusy(false) }
          }}>Add to collection</button>
        </>}
        </div>
      return isWanted
        ? <div key={key} role="listitem" className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-2xl border border-border/45 bg-background/35 p-2.5 [contain-intrinsic-size:auto_10.5rem] [content-visibility:auto] dark:bg-background/22">
            {art}
            <div className="min-w-0 space-y-1.5">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">{details}</div>
                {/* An owned pocket with an upgrade want is normal. "Owned" would read as owning this wanted printing, so the tag names the want; the add controls below stay hidden for it. */}
                {entry.occupied && <span title="This pocket already holds a copy" className="inline-flex shrink-0 items-center rounded-full border border-border/60 bg-muted/35 px-2 py-1 text-[10px] font-semibold text-muted-foreground">Upgrade</span>}
              </div>
              {destination}
              {actions}
            </div>
          </div>
        : <div key={key} role="listitem" className="min-w-0 space-y-2 p-3">
            <div className="flex min-h-14 min-w-0 items-center gap-3 text-left">{art}<div className="min-w-0 flex-1">{details}</div></div>
            {destination}
            {actions}
          </div>
    })}
    </div>}
    {!isWanted && noticeEl}
  </section>
}
