"use client"

import { SetPresetPicker, SetChecklistScopePreview } from "@/components/set-preset-picker"
import type { SetChecklist } from "@/lib/domain/binder-presets"
import type { TCGSetSummary } from "@/lib/tcg-set-slots"
import { useState } from "react"
import { blankPreset, speciesPreset, printingPreset, printingTarget, parseBinderCreationDraft, type BinderCreationDraft } from "@/lib/binder-creation-draft"
import { COLLECTION_CREATION_LIMITS } from "@/lib/domain/storage-creation"
import { BINDER_NAME_MAX_LENGTH } from "@/lib/binders/model"
import { CARD_LANGUAGES, type CardLanguage } from "@/lib/domain/cards"
import { POKEMON_CATALOG, formatPokemonDisplayName } from "@/lib/pokemon-catalog"
import { GENERATIONS } from "@/components/binder/binder-app-model"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import { useCardSearch } from "@/hooks/use-card-search"
import { buildOfflineCardIndex } from "@/lib/offline-card-index"

const speciesLabel = (id: number) => formatPokemonDisplayName(POKEMON_CATALOG.find(p => p.id === id)?.name ?? `Pokémon ${id}`)
const offlineCards = () => buildOfflineCardIndex([])
const control = "min-h-10 rounded-xl border border-border/60 bg-background px-3 text-base"

/** Private staged creation surface. The callback receives a draft, never a save/queue acknowledgement. */
export function BinderCreationPresets({ ownerUserId, onDraft, isOnline, disabled = false, initialSet, nativeCreation = false }: {
  ownerUserId: string; onDraft: (draft: BinderCreationDraft) => void; isOnline: boolean; disabled?: boolean; initialSet?: TCGSetSummary; nativeCreation?: boolean
}) {
  const [name, setName] = useState("")
  const [kind, setKind] = useState<BinderCreationDraft["kind"]>("binder")
  const [location, setLocation] = useState("")
  const [mode, setMode] = useState(initialSet ? "set" : "blank")
  const [setChecklist, setSetChecklist] = useState<SetChecklist | null>(null)
  const [generation, setGeneration] = useState(1)
  const [query, setQuery] = useState("")
  const [species, setSpecies] = useState<number[]>([])
  const [printings, setPrintings] = useState<SearchCardResult[]>([])
  const [language, setLanguage] = useState<CardLanguage>("en")
  const [setFilter, setSetFilter] = useState("")
  const [previewPage, setPreviewPage] = useState(0)
  const [message, setMessage] = useState("")
  const search = useCardSearch(query, mode === "printings", offlineCards, { language, includeNonPokemon: true })
  const gen = GENERATIONS.find(g => g.id === generation)!
  const manifest = mode === "set" ? setChecklist?.manifest ?? blankPreset() : mode === "blank" ? blankPreset() : mode === "national" ? speciesPreset("National Dex", POKEMON_CATALOG.map(p => p.id), "national-dex")
    : mode === "generation" ? speciesPreset(gen.region, POKEMON_CATALOG.filter(p => p.id >= gen.start && p.id <= gen.end).map(p => p.id), `generation-${gen.id}`)
      : mode === "species" ? speciesPreset("Selected species", species) : printingPreset(printings)
  const pages = Math.max(1, Math.ceil(manifest.entries.length / 16))
  const page = Math.min(previewPage, pages - 1)
  const matching = POKEMON_CATALOG.filter(p => `${p.id} ${p.name}`.toLowerCase().includes(query.toLowerCase())).slice(0, 20)
  const cards = search.cards.filter(c => (!species.length || c.dexIds.some(id => species.includes(id)))
    && (!setFilter || `${c.set.id} ${c.set.name}`.toLowerCase().includes(setFilter.toLowerCase())))
  const toggleSpecies = (id: number) => { setSpecies(previous => previous.includes(id) ? previous.filter(p => p !== id) : [...previous, id]); setPreviewPage(0) }
  const targetLabel = (index: number) => {
    const target = manifest.entries[index].target
    if (target?.kind === "pokemon") return speciesLabel(target.pokemonId)
    if (target?.kind !== "card") return "Free slot"
    if (mode === "set") {
      const card = setChecklist?.scope.cards.find(c => c.cardId === target.cardId)
      return `${card?.name ?? target.cardId} · #${card?.localId} · ${target.language} · ${target.finish ?? "Any finish"}`
    }
    return `${printings[index]?.name ?? target.cardId} · ${printings[index]?.set.name} · ${target.language}`
  }
  return <form aria-label="Preset creation draft" className="mt-3 space-y-3 border-t border-border pt-3" onSubmit={event => {
    event.preventDefault()
    if (disabled || !isOnline || (mode === "set" && !setChecklist)) return
    try {
      onDraft(parseBinderCreationDraft({ version: 1, operationId: crypto.randomUUID(), ownerUserId, name, manifest, ...(nativeCreation ? { kind, location: kind === "custom" ? location : null } : {}), ...(mode === "set" && setChecklist ? { setChecklist } : {}) }))
      setMessage(nativeCreation ? "Review the copied targets before confirming." : "Draft prepared only. No binder has been saved.")
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not prepare draft") }
  }}>
    {nativeCreation && <>
      <label className="block text-xs">Storage kind<select aria-label="Storage kind" value={kind} onChange={e => setKind(e.target.value as BinderCreationDraft["kind"])} className={`${control} mt-1 w-full`}>
        <option value="binder">Binder</option><option value="custom">Custom storage</option>
      </select></label>
      <p className="text-xs text-muted-foreground">{kind === "custom" ? "Starts in List." : "Starts in Binder."} You can change the view later. Both use the same collection allowance.</p>
    </>}
    <p className="text-sm font-semibold">Starting arrangement</p>
    <p className="text-xs text-muted-foreground">Targets stay editable. Selecting targets adds no owned cards or wanted entries.</p>
    <label className="block text-xs">{nativeCreation ? "Storage name" : "New binder name"}<input aria-label={nativeCreation ? "Storage name" : "New binder name"} value={name} maxLength={BINDER_NAME_MAX_LENGTH} onChange={e => setName(e.target.value)} className={`${control} mt-1 w-full`} /></label>
    {nativeCreation && kind === "custom" && <label className="block text-xs">Location (optional)<input aria-label="Location (optional)" value={location} maxLength={COLLECTION_CREATION_LIMITS.location} onChange={e => setLocation(e.target.value)} className={`${control} mt-1 w-full`} />
      <span className="mt-1 block text-xs text-muted-foreground">Up to {COLLECTION_CREATION_LIMITS.location} characters. Shared with your linked partner, never included in public sharing by this flow.</span>
    </label>}
    <button type="submit" disabled={disabled || !isOnline || !name.trim() || (mode !== "blank" && manifest.entries.length === 0)} className="min-h-11 w-full rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-40">{nativeCreation ? "Review storage" : "Prepare draft"}</button>
    <label className="block text-xs">Preset<select aria-label="Starting arrangement" value={mode} onChange={e => { setMode(e.target.value); setSetChecklist(null); setPreviewPage(0); setQuery(""); setMessage("") }} className={`${control} mt-1 w-full`}>
      <option value="set">Set / variant checklist</option><option value="blank">Blank</option><option value="national">National Dex</option><option value="generation">Generation</option><option value="species">Selected species</option><option value="printings">Selected printings</option>
    </select></label>
    {mode === "set" && <SetPresetPicker isOnline={isOnline} initialSet={initialSet} onChange={value => { setSetChecklist(value); setPreviewPage(0); setMessage("") }} />}
    {mode === "set" && setChecklist && <SetChecklistScopePreview checklist={setChecklist} />}
    {mode === "generation" && <select aria-label="Generation" className={`${control} w-full`} value={generation} onChange={e => { setGeneration(Number(e.target.value)); setPreviewPage(0) }}>{GENERATIONS.filter(g => g.id > 0).map(g => <option key={g.id} value={g.id}>{g.region} · {g.name}</option>)}</select>}
    {(mode === "species" || mode === "printings") && <>
      {species.length > 0 && <div aria-label="Selected species" className="flex flex-wrap gap-1">{species.map(id => <button type="button" key={id} className={`${control} text-sm`} onClick={() => toggleSpecies(id)} aria-label={`Remove species ${speciesLabel(id)}`}>{speciesLabel(id)} ×</button>)}</div>}
      <input aria-label={mode === "species" ? "Find species" : "Find catalog printings"} placeholder={mode === "species" ? "Pokémon name or number" : "Name, set, number or illustrator"} value={query} onChange={e => setQuery(e.target.value)} className={`${control} w-full`} />
      {mode === "species" && <div aria-label="Species results" className="grid grid-cols-2 gap-1">{matching.map(p => <button type="button" key={p.id} aria-pressed={species.includes(p.id)} onClick={() => toggleSpecies(p.id)} className={`${control} min-w-0 break-words text-left text-sm aria-pressed:bg-primary/15`}>{formatPokemonDisplayName(p.name)}</button>)}</div>}
    </>}
    {mode === "printings" && <>
      <p className="text-xs text-muted-foreground">Select individual catalog results in your preferred order. Search is a partial list, never an automatic “all cards” preset.</p>
      {species.length > 0 && <p className="text-xs">Filtered to your selected species.</p>}
      <div className="flex gap-2"><select aria-label="Printing language" className={`${control} min-w-0 flex-1`} value={language} onChange={e => setLanguage(e.target.value as CardLanguage)}>{CARD_LANGUAGES.map(l => <option key={l}>{l}</option>)}</select>
      <input aria-label="Filter printing set" placeholder="Filter set" value={setFilter} onChange={e => setSetFilter(e.target.value)} className={`${control} min-w-0 flex-1`} /></div>
      {(!isOnline || search.offline) && <p role="status" className="text-xs text-muted-foreground">Only cached catalog evidence is available. Connect to find uncached printings. Creation needs a connection.</p>}
      {search.loading && <p role="status" className="text-xs">Searching catalog…</p>}
      {!search.loading && query.length >= 2 && !cards.length && <p className="text-xs">No matching catalog printings. Try another search or connect to load more.</p>}
      <div aria-label="Printing results" className="space-y-1">{cards.map(c => {
        const target = printingTarget(c)
        return <button type="button" key={`${c.id}:${c.language}`} disabled={!target} className={`${control} w-full break-words py-2 text-left text-sm disabled:opacity-50`} onClick={() => { setPrintings(previous => [...previous, structuredClone(c)]); setPreviewPage(0) }}>
          {c.name} · {c.set.name} #{c.localId} · {c.language ?? "Unknown language"}{!target && " · Catalog evidence missing"}
        </button>
      })}</div>
      {printings.length > 0 && <button type="button" className={`${control} text-sm`} onClick={() => setPrintings(previous => previous.slice(0, -1))}>Remove last printing</button>}
    </>}
    <section aria-label="Target preview" className="rounded-xl bg-muted/40 p-3 text-xs">
      <p className="font-semibold">{manifest.entries.length} targets · {mode === "set" ? "Copied set scope" : mode === "printings" ? "One per selected printing" : mode === "blank" ? "No stored slots" : "One per species"}</p>
      {manifest.entries.length === 0 ? <p className="mt-1">{mode === "blank" ? "Start empty and add slots later. Page padding is visual only." : "Choose targets to preview."}</p> : <>
        <ol start={page * 16 + 1} className="mt-2 list-inside list-decimal space-y-1 break-words">{manifest.entries.slice(page * 16, (page + 1) * 16).map((entry, i) => <li key={entry.id}>{targetLabel(page * 16 + i)}</li>)}</ol>
        <div className="mt-2 flex items-center justify-between gap-2"><button type="button" disabled={page === 0} className={`${control} text-xs disabled:opacity-40`} onClick={() => setPreviewPage(page - 1)}>Previous targets</button><span>Page {page + 1} of {pages}</span><button type="button" disabled={page + 1 === pages} className={`${control} text-xs disabled:opacity-40`} onClick={() => setPreviewPage(page + 1)}>Next targets</button></div>
      </>}
    </section>
    <p role="status" className="text-xs text-muted-foreground">{message || (!isOnline ? "Preview only while offline. Connect before preparing creation." : (nativeCreation ? "A copy of these targets will be saved. Catalog changes will not change this collection." : "Internal preview only. Binder creation is not enabled."))}</p>
  </form>
}
