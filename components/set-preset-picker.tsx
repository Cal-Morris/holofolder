"use client"

import { useEffect, useRef, useState } from "react"
import { CARD_LANGUAGES, type CardLanguage } from "@/lib/domain/cards"
import type { BinderSnapshot } from "@/lib/domain/binder-slots"
import type { SetChecklist } from "@/lib/domain/binder-presets"
import type { TCGSetSlotCard, TCGSetSlotsResponse, TCGSetSummary } from "@/lib/tcg-set-slots"
import { generateSetChecklist, isSetChecklistCustomised, SET_FINISH_FLAGS, verifiedSetFinishes, type SetPresetFinish } from "@/lib/set-preset"
import { resolveSetSearchAlias } from "@/lib/set-search-aliases"

const control = "min-h-10 rounded-xl border border-border/60 bg-background px-3 text-base"
const labels = { normal: "Normal", holo: "Holo", reverse_holo: "Reverse holo", jumbo: "Jumbo" }
/** No cache/queue writes. The receiving creation surface owns the current unsaved scope. */
export function SetPresetPicker({ isOnline, initialSet, onChange }: {
  isOnline: boolean; initialSet?: TCGSetSummary; onChange: (checklist: SetChecklist | null) => void
}) {
  const [query, setQuery] = useState(initialSet?.id ?? "")
  const [sets, setSets] = useState<TCGSetSummary[]>([])
  const [language, setLanguage] = useState<CardLanguage>("en")
  const [catalog, setCatalog] = useState<{ set: TCGSetSummary; cards: TCGSetSlotCard[]; capturedAt: string } | null>(null)
  const [finishes, setFinishes] = useState<SetPresetFinish[]>([])
  const [excluded, setExcluded] = useState<string[]>([])
  const [promos, setPromos] = useState<TCGSetSlotCard[]>([])
  const [promoQuery, setPromoQuery] = useState("")
  const [promoResults, setPromoResults] = useState<TCGSetSlotCard[]>([])
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  function publish(nextCatalog = catalog, nextFinishes = finishes, nextExcluded = excluded, nextPromos = promos) {
    if (!nextCatalog) { onChange(null); return false }
    try {
      const checklist = generateSetChecklist({ ...nextCatalog, language, finishes: nextFinishes, excludedCardIds: nextExcluded, promos: nextPromos })
      onChange(checklist); setMessage(""); return true
    } catch {
      setMessage("This catalog selection could not be used. No new checklist was prepared.")
      return false
    }
  }
  async function load(setId?: string, promo = false) {
    if (!isOnline) return
    const sequence = ++request.current
    setLoading(true); setMessage("")
    if (!promo) { setCatalog(null); onChange(null); setExcluded([]); setPromos([]); setPromoResults([]) }
    try {
      const params = new URLSearchParams({ language, ...(setId ? { setId: resolveSetSearchAlias(setId) } : { query: resolveSetSearchAlias(query) }) })
      const response = await fetch(`/app/api/tcg-set-slots?${params}`, { cache: "no-store" })
      if (!response.ok) throw new Error(`Catalog read failed (${response.status})`)
      const data = await response.json() as TCGSetSlotsResponse
      if (sequence !== request.current) return
      if (promo) {
        if (!Array.isArray(data.cards)) throw new Error("Full promo catalog unavailable")
        setPromoResults(data.cards); return
      }
      if (!setId) { setSets(data.sets ?? []); if (!data.sets?.length) setMessage("No matching catalog set. Nothing substituted."); return }
      if (!data.selectedSet || data.selectedSet.id !== resolveSetSearchAlias(setId) || !Array.isArray(data.cards)) throw new Error("Full set catalog unavailable. No checklist generated.")
      const next = { set: data.selectedSet, cards: data.cards, capturedAt: new Date().toISOString() }
      if (!publish(next, finishes, [], [])) return
      setCatalog(next); setSets([])
    } catch (error) { if (sequence === request.current) setMessage(error instanceof Error ? error.message : "Catalog unavailable") }
    finally { if (sequence === request.current) setLoading(false) }
  }
  return <section aria-label="Set preset scope" className="space-y-3">
    <p className="text-xs text-muted-foreground">Copy every catalogued card, including Trainers, items, Energy, repeated Pokémon, secrets and subsets. No cards become owned.</p>
    <div className="flex gap-2"><input aria-label="Find set preset" placeholder="Set name, ID or code" className={`${control} min-w-0 flex-1`} value={query} onChange={e => setQuery(e.target.value)} /><button type="button" className={`${control} text-sm`} disabled={!isOnline || loading || query.trim().length < 2} onClick={() => void load()}>Find set</button></div>
    <label className="block text-xs">Checklist language<select aria-label="Checklist language" className={`${control} mt-1 w-full`} value={language} onChange={e => {
      request.current++; setLoading(false); setLanguage(e.target.value as CardLanguage); setCatalog(null); setSets([]); setPromos([]); setPromoResults([]); onChange(null)
    }}>{CARD_LANGUAGES.map(l => <option key={l}>{l}</option>)}</select></label>
    {initialSet && !catalog && <button type="button" className={`${control} w-full break-words text-sm`} disabled={!isOnline || loading} onClick={() => void load(initialSet.id)}>Load {initialSet.name} checklist</button>}
    <div aria-label="Matching preset sets" className="space-y-1">{sets.map(s => <button key={s.id} type="button" className={`${control} w-full break-words py-2 text-left text-sm`} disabled={loading} onClick={() => void load(s.id)}>{s.name} · {s.id}</button>)}</div>
    {catalog && <>
      <p className="break-words text-sm font-semibold">{catalog.set.name} · {catalog.set.id}</p>
      <fieldset className="space-y-1"><legend className="text-xs font-semibold">Finish scope</legend>
        <button type="button" className={`${control} w-full text-left text-sm`} aria-pressed={!finishes.length} onClick={() => { if (publish(catalog, [])) setFinishes([]) }}>Base checklist, any finish</button>
        <p className="text-xs text-muted-foreground">Select verified finishes for a scoped variant checklist. Any finish does not mean Normal. First edition and promo stamps are not supported finish constraints.</p>
        {(Object.keys(SET_FINISH_FLAGS) as SetPresetFinish[]).map(f => {
          const count = [...catalog.cards, ...promos].filter(c => c.languageConfirmed === true && c.language === language && verifiedSetFinishes(c).includes(f)).length
          return <button type="button" key={f} aria-pressed={finishes.includes(f)} disabled={!count} className={`${control} w-full text-left text-sm disabled:opacity-50`} onClick={() => {
            const next = finishes.includes(f) ? finishes.filter(x => x !== f) : [...finishes, f]; if (publish(catalog, next)) setFinishes(next)
          }}>{labels[f]} · {count} verified{!count && " · Unavailable"}</button>
        })}
      </fieldset>
      <details className="text-xs"><summary className="min-h-10 cursor-pointer py-3">Optional promos and exclusions</summary>
        <p className="mb-2">Promos are not automatically associated with this set. Load an actual promo set ID, then select cards explicitly.</p>
        <div className="flex gap-2"><input aria-label="Promo set ID" value={promoQuery} onChange={e => setPromoQuery(e.target.value)} className={`${control} min-w-0 flex-1`} /><button type="button" disabled={!isOnline || loading || !promoQuery.trim()} className={`${control} text-sm`} onClick={() => void load(promoQuery, true)}>Load promos</button></div>
        {promoResults.map(c => <button key={c.id} type="button" disabled={!c.languageConfirmed || c.language !== language || promos.some(p => (p.canonicalId ?? p.id) === (c.canonicalId ?? c.id)) || catalog.cards.some(p => (p.canonicalId ?? p.id) === (c.canonicalId ?? c.id))} className={`${control} mt-1 w-full break-words py-2 text-left text-sm disabled:opacity-40`} onClick={() => { const next = [...promos, c]; if (publish(catalog, finishes, excluded, next)) setPromos(next) }}>Add promo {c.name} #{c.localId}</button>)}
        {promos.map(c => <button key={c.id} type="button" className={`${control} mt-1 w-full break-words text-left text-sm`} onClick={() => { const next = promos.filter(p => p.id !== c.id); const nextExcluded = excluded.filter(id => id !== (c.canonicalId ?? c.id)); if (publish(catalog, finishes, nextExcluded, next)) { setPromos(next); setExcluded(nextExcluded) } }}>Remove promo {c.name}</button>)}
        <div className="mt-2 max-h-52 space-y-1 overflow-y-auto" aria-label="Card exclusions">{catalog.cards.map(c => {
          const id = c.canonicalId ?? c.id
          return <button type="button" key={id} aria-pressed={excluded.includes(id)} className={`${control} w-full break-words py-2 text-left text-sm`} onClick={() => { const next = excluded.includes(id) ? excluded.filter(x => x !== id) : [...excluded, id]; if (publish(catalog, finishes, next)) setExcluded(next) }}>{excluded.includes(id) ? "Restore" : "Exclude"} #{c.localId} {c.name}</button>
        })}</div>
      </details>
    </>}
    <p role="status" className="text-xs text-muted-foreground">{loading ? "Reading catalog…" : message || (!isOnline ? "Saved scope remains viewable offline. Connect to load an uncached set or prepare creation." : "Catalog gaps and unsupported finishes remain unavailable.")}</p>
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
