"use client"

import { useMemo, useState } from "react"
import BinderOfflinePrep, { type BinderOfflineSource } from "@/components/binder-offline-prep"
import CardShowPrep from "@/components/card-show-prep"
import { getSetIdFromCardId, type HuntSourceItem } from "@/lib/show-hunt"
import type { TCGSetSummary } from "@/lib/tcg-set-slots"

/** Runs inside Quick mode's existing overlay, including its focus trap and history entry. */
export default function ShowOfflinePrep({ items, isOnline, binder }: { items: readonly HuntSourceItem[]; isOnline: boolean; binder?: BinderOfflineSource }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<TCGSetSummary[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wanted = useMemo(() => items.flatMap(item => item.wanted_cards ?? []), [items])
  const candidates = useMemo(() => {
    const sets = new Map<string, TCGSetSummary>()
    for (const card of wanted) {
      const id = getSetIdFromCardId(card.card_id)
      sets.set(id, { id, name: card.card_set || id })
    }
    for (const set of results) sets.set(set.id, set)
    return [...sets.values()]
  }, [wanted, results])
  const search = async () => {
    if (!navigator.onLine || !query.trim() || searching) return
    setSearching(true)
    setError(null)
    try {
      const response = await fetch(`/api/tcg-set-slots?${new URLSearchParams({ query: query.trim() })}`)
      if (!response.ok) throw new Error("Couldn't search sets. Try again when connected.")
      const payload = await response.json()
      const sets = Array.isArray(payload.sets) ? payload.sets.filter((set: TCGSetSummary) => set && typeof set.id === "string" && typeof set.name === "string") : []
      setResults(current => [...new Map([...current, ...sets].map(set => [set.id, set])).values()])
      if (!sets.length) setError("No sets found. Try a set name or code.")
    } catch { setError("Couldn't search sets. Try again when connected.") }
    finally { setSearching(false) }
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[var(--dock-clearance)] pt-3">
      {binder && <BinderOfflinePrep {...binder} isOnline={isOnline} />}
      <p className="mb-3 mt-4 text-sm text-muted-foreground">Optional extra sets</p>
      <form onSubmit={event => { event.preventDefault(); void search() }} className="flex gap-2">
        <input type="search" aria-label="Find sets to save" placeholder="Set name or code" value={query} onChange={event => setQuery(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-base" />
        <button type="submit" disabled={!isOnline || searching || !query.trim()} className="min-h-10 rounded-xl bg-muted px-3 text-sm font-medium disabled:opacity-50">{searching ? "Finding…" : "Find"}</button>
      </form>
      {error && <p role="status" className="mt-2 text-xs">{error}</p>}
      <CardShowPrep embedded candidateSets={candidates} />
    </div>
  )
}
