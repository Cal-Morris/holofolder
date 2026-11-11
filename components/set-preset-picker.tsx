"use client"

import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import CardImage from "@/components/card-image"
import { OptionRow } from "@/components/ui/option-row"
import { Select } from "@/components/ui/select"
import { CARD_LANGUAGES, type CardLanguage } from "@/lib/domain/cards"
import type { BinderSnapshot } from "@/lib/domain/binder-slots"
import type { SetChecklist } from "@/lib/domain/binder-presets"
import type { TCGSetSlotCard, TCGSetSlotsResponse, TCGSetSummary } from "@/lib/tcg-set-slots"
import type { PreviewCard } from "@/lib/binder-creation-wizard"
import { generateSetChecklist, isSetChecklistCustomised, SET_FINISH_FLAGS, verifiedSetFinishes, type SetPresetFinish } from "@/lib/set-preset"
import { resolveSetSearchAlias } from "@/lib/set-search-aliases"
import { formatCardLanguageLabel } from "@/lib/card-labels"

const field = "h-11 min-w-0 rounded-2xl border border-border/60 bg-background/60 px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50 md:text-sm"
const action = "h-11 shrink-0 rounded-2xl border border-border/60 bg-background/60 px-4 text-sm font-semibold transition-colors hover:border-primary/45 hover:bg-primary/5 disabled:opacity-45"
const labels = { normal: "Normal", holo: "Holo", reverse_holo: "Reverse holo", jumbo: "Jumbo" }
/** Rows shown at once in the leave-out picker; search narrows the rest. */
const EXCLUSION_ROWS = 12
const cardKey = (c: TCGSetSlotCard) => c.canonicalId ?? c.id
const setDetail = (s: TCGSetSummary) => [s.id, s.officialCardCount ? `${s.officialCardCount} cards` : "", s.seriesName ?? ""].filter(Boolean).join(" · ")
const thumb = (c: TCGSetSlotCard) => <span className="trading-card relative block w-8 overflow-hidden rounded-[4px] bg-muted">{c.image && <CardImage src={c.image} alt="" fill sizes="32px" className="object-cover" />}</span>
type Catalog = { set: TCGSetSummary; cards: TCGSetSlotCard[]; capturedAt: string; dex: Map<string, number> }

/**
 * Choose a set and, optionally, which versions, promos and cards to leave out. No cache/queue writes: the receiving
 * creation surface owns the current unsaved scope. `part` shows only the set choice ("scope") or only the extras
 * ("extras"), or nothing ("none") while the wizard is on another step; the choices are kept either way.
 */
export function SetPresetPicker({ isOnline, initialSet, onChange, onCards, part = "all" }: {
  isOnline: boolean; initialSet?: TCGSetSummary; onChange: (checklist: SetChecklist | null) => void
  /** Catalog images and Pokémon for the chosen cards, for a picture preview. Never sent anywhere. */
  onCards?: (cards: Map<string, PreviewCard>) => void
  part?: "all" | "scope" | "extras" | "none"
}) {
  const [query, setQuery] = useState(initialSet?.id ?? "")
  const [sets, setSets] = useState<TCGSetSummary[]>([])
  const [language, setLanguage] = useState<CardLanguage>("en")
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [finishes, setFinishes] = useState<SetPresetFinish[]>([])
  const [excluded, setExcluded] = useState<string[]>([])
  const [promos, setPromos] = useState<TCGSetSlotCard[]>([])
  const [promoQuery, setPromoQuery] = useState("")
  const [promoResults, setPromoResults] = useState<TCGSetSlotCard[]>([])
  const [leaveOutQuery, setLeaveOutQuery] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  function publish(nextCatalog = catalog, nextFinishes = finishes, nextExcluded = excluded, nextPromos = promos) {
    if (!nextCatalog) { onChange(null); return false }
    try {
      const checklist = generateSetChecklist({ ...nextCatalog, language, finishes: nextFinishes, excludedCardIds: nextExcluded, promos: nextPromos })
      onChange(checklist); setMessage("")
      onCards?.(new Map([...nextCatalog.cards, ...nextPromos].map(c => [cardKey(c), { name: c.name, localId: c.localId, image: c.image, dexId: nextCatalog.dex.get(c.id) }])))
      return true
    } catch {
      setMessage("That selection can't be used. Nothing was changed.")
      return false
    }
  }
  async function load(setId?: string, promo = false) {
    if (!isOnline) return
    const sequence = ++request.current
    setLoading(true); setMessage("")
    if (!promo && setId) { setCatalog(null); onChange(null); setExcluded([]); setPromos([]); setPromoResults([]) }
    try {
      const params = new URLSearchParams({ language, ...(setId ? { setId: resolveSetSearchAlias(setId) } : { query: resolveSetSearchAlias(query) }) })
      const response = await fetch(`/app/api/tcg-set-slots?${params}`, { cache: "no-store" })
      if (!response.ok) throw new Error("Couldn't load sets just now. Try again.")
      const data = await response.json() as TCGSetSlotsResponse
      if (sequence !== request.current) return
      if (promo) {
        if (!Array.isArray(data.cards)) throw new Error("Those promos couldn't be loaded.")
        setPromoResults(data.cards); if (!data.cards.length) setMessage("No promos found with that code."); return
      }
      if (!setId) { setSets(data.sets ?? []); if (!data.sets?.length) setMessage("No set found with that name or code."); return }
      if (!data.selectedSet || data.selectedSet.id !== resolveSetSearchAlias(setId) || !Array.isArray(data.cards)) throw new Error("This set couldn't be loaded in full, so nothing was added.")
      const dex = new Map<string, number>()
      for (const slot of data.slots ?? []) for (const card of slot.cards) if (slot.dexId > 0) dex.set(card.id, slot.dexId)
      const next = { set: data.selectedSet, cards: data.cards, capturedAt: new Date().toISOString(), dex }
      if (!publish(next, finishes, [], [])) return
      setCatalog(next); setSets([])
    } catch (error) { if (sequence === request.current) setMessage(error instanceof Error ? error.message : "Couldn't load sets just now. Try again.") }
    finally { if (sequence === request.current) setLoading(false) }
  }
  const status = <p role="status" className="text-xs text-muted-foreground empty:hidden">{loading ? "Loading…" : message || (!isOnline ? "Connect to the internet to load a set." : "")}</p>
  if (part === "none") return null
  const showScope = part !== "extras", showExtras = part !== "scope" && catalog
  const canFind = isOnline && !loading && query.trim().length >= 2, canLoadPromos = isOnline && !loading && Boolean(promoQuery.trim())
  const confirmed = (c: TCGSetSlotCard) => c.languageConfirmed === true && c.language === language
  const finishCounts = catalog ? (Object.keys(SET_FINISH_FLAGS) as SetPresetFinish[]).map(f => ({ f, count: [...catalog.cards, ...promos].filter(c => confirmed(c) && verifiedSetFinishes(c).includes(f)).length })).filter(x => x.count > 0) : []
  const needle = leaveOutQuery.trim().toLowerCase()
  const leaveOutMatches = catalog ? catalog.cards.filter(c => !needle || `#${c.localId} ${c.name}`.toLowerCase().includes(needle)) : []
  // Cards already left out stay on top, so they are easy to bring back.
  const leaveOutShown = [...leaveOutMatches.filter(c => excluded.includes(cardKey(c))), ...leaveOutMatches.filter(c => !excluded.includes(cardKey(c)))].slice(0, Math.max(EXCLUSION_ROWS, excluded.length))
  const toggleExcluded = (id: string) => { const next = excluded.includes(id) ? excluded.filter(x => x !== id) : [...excluded, id]; if (publish(catalog, finishes, next)) setExcluded(next) }
  const togglePromo = (c: TCGSetSlotCard) => {
    const chosen = promos.some(p => p.id === c.id)
    const next = chosen ? promos.filter(p => p.id !== c.id) : [...promos, c]
    const nextExcluded = chosen ? excluded.filter(id => id !== cardKey(c)) : excluded
    if (publish(catalog, finishes, nextExcluded, next)) { setPromos(next); setExcluded(nextExcluded) }
  }
  return <section aria-label="Set preset scope" className="space-y-4">
    {showScope && <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Every card in the set gets a pocket, Trainers, Energy and secret rares included.</p>
      <div className="flex gap-2">
        <span className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" aria-label="Find set preset" placeholder="Set name or code" className={`${field} w-full pl-9`} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (canFind) void load() } }} />
        </span>
        <button type="button" className={action} disabled={!canFind} onClick={() => void load()}>Find set</button>
      </div>
      <label className="block text-sm font-medium">Card language
        <Select aria-label="Checklist language" className="mt-1 w-full" value={language} onChange={e => {
          request.current++; setLoading(false); setLanguage(e.target.value as CardLanguage); setCatalog(null); setSets([]); setPromos([]); setPromoResults([]); onChange(null)
        }}>{CARD_LANGUAGES.map(l => <option key={l} value={l}>{formatCardLanguageLabel(l)}</option>)}</Select>
      </label>
      {initialSet && !catalog && <OptionRow title={`Use ${initialSet.name}`} detail={setDetail(initialSet)} disabled={!isOnline || loading} onClick={() => void load(initialSet.id)} />}
      {catalog && !sets.length && <OptionRow selected title={catalog.set.name} detail={`${catalog.set.id} · ${catalog.cards.length} cards`} onClick={() => { setSets([catalog.set]) }}
        media={<span className="flex -space-x-4">{catalog.cards.slice(0, 3).map(c => <span key={c.id}>{thumb(c)}</span>)}</span>} />}
      {sets.length > 0 && <div role="group" aria-label="Matching preset sets" className="space-y-1.5">
        {sets.map(s => <OptionRow key={s.id} title={s.name} detail={setDetail(s)} selected={catalog?.set.id === s.id} disabled={loading} onClick={() => void load(s.id)} />)}
      </div>}
      {part === "scope" && status}
    </div>}
    {showExtras && <div className="space-y-4">
      <fieldset className="space-y-1.5"><legend className="mb-1 text-sm font-semibold">Which versions?</legend>
        <OptionRow selected={!finishes.length} title="One of each card" detail="Any version fills the pocket" onClick={() => { if (publish(catalog, [])) setFinishes([]) }} />
        {finishCounts.map(({ f, count }) => <OptionRow key={f} selected={finishes.includes(f)} title={labels[f]} detail={`${count} ${count === 1 ? "card" : "cards"}, one pocket each`}
          onClick={() => { const next = finishes.includes(f) ? finishes.filter(x => x !== f) : [...finishes, f]; if (publish(catalog, next)) setFinishes(next) }} />)}
      </fieldset>
      <fieldset className="space-y-1.5"><legend className="mb-1 text-sm font-semibold">Add promos <span className="font-normal text-muted-foreground">(optional)</span></legend>
        <p className="text-xs text-muted-foreground">Promos aren&apos;t part of a set. Enter the promo set&apos;s code, like svp, then tap the cards to add.</p>
        <div className="flex gap-2">
          <input aria-label="Promo set ID" placeholder="Promo set code" value={promoQuery} onChange={e => setPromoQuery(e.target.value)} className={`${field} flex-1`}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (canLoadPromos) void load(promoQuery.trim(), true) } }} />
          <button type="button" disabled={!canLoadPromos} className={action} onClick={() => void load(promoQuery.trim(), true)}>Load promos</button>
        </div>
        {[...promos.filter(p => !promoResults.some(r => r.id === p.id)), ...promoResults].map(c => {
          const chosen = promos.some(p => p.id === c.id)
          return <OptionRow key={c.id} selected={chosen} aria-label={`Promo ${c.name} #${c.localId}`} title={c.name} detail={`${c.set.name} · #${c.localId}`} media={thumb(c)}
            disabled={!chosen && (!confirmed(c) || catalog.cards.some(p => cardKey(p) === cardKey(c)))} onClick={() => togglePromo(c)} />
        })}
      </fieldset>
      <fieldset className="space-y-1.5"><legend className="mb-1 text-sm font-semibold">Leave cards out <span className="font-normal text-muted-foreground">(optional)</span></legend>
        <span className="relative block">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" aria-label="Find a card to leave out" placeholder="Card name or number" value={leaveOutQuery} onChange={e => setLeaveOutQuery(e.target.value)} className={`${field} w-full pl-9`} />
        </span>
        <div role="group" aria-label="Card exclusions" className="space-y-1.5">
          {leaveOutShown.map(c => <OptionRow key={cardKey(c)} selected={excluded.includes(cardKey(c))} aria-label={`Leave out #${c.localId} ${c.name}`} title={c.name} detail={`#${c.localId}${excluded.includes(cardKey(c)) ? " · left out" : ""}`} media={thumb(c)} onClick={() => toggleExcluded(cardKey(c))} />)}
        </div>
        <p className="text-xs text-muted-foreground">{excluded.length ? `${excluded.length} left out. ` : ""}{leaveOutMatches.length > leaveOutShown.length ? `Showing ${leaveOutShown.length} of ${leaveOutMatches.length}. Search to find others.` : leaveOutMatches.length ? "" : "No cards match."}</p>
      </fieldset>
      {part === "extras" && status}
    </div>}
    {part === "all" && status}
  </section>
}

/** A pure saved snapshot view: no catalog refresh, subscription or ownership assumptions. */
export function SetChecklistScopePreview({ checklist, binder }: { checklist: SetChecklist; binder?: BinderSnapshot }) {
  const s = checklist.scope
  return <section aria-label="Copied set scope" className="space-y-1 break-words text-xs">
    {binder && isSetChecklistCustomised(checklist, binder) && <p className="font-semibold">Customised preset, completion uses current targets</p>}
    <p className="font-semibold">{checklist.manifest.entries.length} targets · {s.setId} · {s.language} · {s.finishes.length ? s.finishes.join(", ") : "Any finish"}</p>
    <p>Copied {s.capturedAt}. {s.promoCardIds.length} selected promos; {s.excludedCardIds.length} exclusions. Later catalog updates do not alter this checklist.</p>
    {s.warnings.map(w => <p key={w} className="text-muted-foreground">{w}</p>)}
    <p>Completion follows current targets. Free-slot extras do not increase the goal; adding or removing targets customises it.</p>
  </section>
}
