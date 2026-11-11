"use client"

import { useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, Layers3, Search, X } from "lucide-react"
import CardImage from "@/components/card-image"
import { SetPresetPicker } from "@/components/set-preset-picker"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { useBilling } from "@/hooks/use-billing"
import { useCardSearch } from "@/hooks/use-card-search"
import { canCreateOwnerBinder } from "@/lib/billing"
import { blankPreset, parseBinderCreationDraft, printingPreset, printingTarget, speciesPreset, type BinderCreationDraft } from "@/lib/binder-creation-draft"
import { BINDER_NAME_MAX_LENGTH, MAX_BINDERS_PER_OWNER } from "@/lib/binders/model"
import { creationSummary, FREE_PAGE_SIZES, pageSizeLabel, suggestedBinderName, type CreationPreset, type PageSize } from "@/lib/binder-creation-wizard"
import type { SlotLocalAcceptance } from "@/lib/binder-slot-editing"
import type { SetChecklist } from "@/lib/domain/binder-presets"
import { COLLECTION_CREATION_LIMITS } from "@/lib/domain/storage-creation"
import { buildOfflineCardIndex } from "@/lib/offline-card-index"
import { formatDexNumber, formatPokemonDisplayName, getOfficialArtworkUrl, POKEMON_CATALOG } from "@/lib/pokemon-catalog"
import { GENERATIONS } from "@/lib/pokemon-generations"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"

export interface NativeBinderCreationBinding {
  actorUserId: string
  ownerUserId: string
  count: number
  available: boolean
  /** The open binder's page size, offered first when it is one every plan can use. */
  currentGrid?: PageSize
  /** `grid` is the chosen page size for a binder, or null for a list. The same draft is resent on a retry. */
  create: (draft: BinderCreationDraft, grid: PageSize | null) => Promise<SlotLocalAcceptance>
}

const offlineCards = () => buildOfflineCardIndex([])
const field = "min-h-11 w-full rounded-2xl border border-border/60 bg-background/85 px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50 md:text-sm"
const speciesName = (id: number) => formatPokemonDisplayName(POKEMON_CATALOG.find(p => p.id === id)?.name ?? `Pokémon ${id}`)

/** Ordered as before: a set, blank, National Dex, a generation, chosen Pokémon, chosen cards. */
const PRESETS: { id: CreationPreset; title: string; line: string; art: number[] }[] = [
  { id: "set", title: "A set", line: "Every card in one set", art: [] },
  { id: "blank", title: "Blank", line: "Start empty and build it your way", art: [] },
  { id: "national", title: "National Dex", line: "A pocket for every Pokémon", art: [1, 4, 7] },
  { id: "generation", title: "A generation", line: "Kanto through Paldea", art: [25, 133, 150] },
  { id: "species", title: "Pick Pokémon", line: "Just the ones you collect", art: [6, 94, 448] },
  { id: "printings", title: "Pick cards", line: "Exact cards, in your order", art: [] },
]

function PresetArt({ preset }: { preset: typeof PRESETS[number] }) {
  if (preset.art.length) return <span className="relative block h-16 w-full" aria-hidden="true">
    {preset.art.map((id, index) => <span key={id} className="absolute top-1/2 h-14 w-14 -translate-y-1/2" style={{ left: `calc(50% - 1.75rem + ${(index - 1) * 1.9}rem)`, zIndex: index === 1 ? 2 : 1 }}>
      <CardImage src={getOfficialArtworkUrl(id)} alt="" fill sizes="56px" className="object-contain drop-shadow-md" />
    </span>)}
  </span>
  return <span className="flex h-16 w-full items-center justify-center" aria-hidden="true">
    {preset.id === "blank" ? <span className="grid grid-cols-3 gap-1">{Array.from({ length: 6 }, (_, i) => <span key={i} className="h-6 w-[1.15rem] rounded-[3px] border border-dashed border-muted-foreground/50" />)}</span>
      : <span className="relative h-14 w-16">{[-12, 0, 12].map((turn, i) => <span key={turn} className="trading-card absolute left-1/2 top-1 w-9 -translate-x-1/2 rounded-[4px] border border-white/25 bg-gradient-to-br from-primary/70 via-sky-400/60 to-emerald-400/60 shadow"
          style={{ transform: `translateX(-50%) rotate(${turn}deg)`, zIndex: i === 1 ? 2 : 1 }} />)}{preset.id === "printings" && <Layers3 className="absolute bottom-0 right-0 z-10 h-4 w-4 text-foreground" />}</span>}
  </span>
}

/**
 * A short guided way to make a binder: choose what it is for, name it and pick its pages, then see the first pages
 * and create it. Choices are kept when going back. Creating reserves pockets only: it never adds cards you own.
 */
export default function NativeBinderCreation({ binding, onClose }: { binding: NativeBinderCreationBinding; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement | null>(null)
  useOverlay(true, onClose, { containerRef: sheet })
  const swipe = useSwipeToDismiss(sheet, onClose)
  const billing = useBilling(binding.actorUserId, binding.ownerUserId, () => {})
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [preset, setPreset] = useState<CreationPreset>("national")
  const [name, setName] = useState<string | null>(null)
  const [list, setList] = useState(false)
  const [location, setLocation] = useState("")
  const [size, setSize] = useState<PageSize>(() => FREE_PAGE_SIZES.find(s => s.rows === binding.currentGrid?.rows && s.cols === binding.currentGrid?.cols) ?? FREE_PAGE_SIZES[FREE_PAGE_SIZES.length - 1])
  const [generation, setGeneration] = useState(1)
  const [setChecklist, setSetChecklist] = useState<SetChecklist | null>(null)
  const [species, setSpecies] = useState<number[]>([])
  const [printings, setPrintings] = useState<SearchCardResult[]>([])
  const [query, setQuery] = useState("")
  const [previewPage, setPreviewPage] = useState(0)
  const [draft, setDraft] = useState<BinderCreationDraft | null>(null)
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [message, setMessage] = useState("")
  const search = useCardSearch(query, step === 2 && preset === "printings", offlineCards, { language: "en", includeNonPokemon: true })
  const gen = GENERATIONS.find(g => g.id === generation)!
  const manifest = useMemo(() => preset === "set" ? setChecklist?.manifest ?? blankPreset() : preset === "blank" ? blankPreset()
    : preset === "national" ? speciesPreset("National Dex", POKEMON_CATALOG.map(p => p.id), "national-dex")
    : preset === "generation" ? speciesPreset(gen.region, POKEMON_CATALOG.filter(p => p.id >= gen.start && p.id <= gen.end).map(p => p.id), `generation-${gen.id}`)
    : preset === "species" ? speciesPreset("Selected species", species) : printingPreset(printings.filter(printingTarget)),
  [preset, setChecklist, gen, species, printings])
  const capped = binding.count >= MAX_BINDERS_PER_OWNER || Boolean(billing?.access && !canCreateOwnerBinder(billing.access, binding.count))
  const blocked = !binding.available || capped || Boolean(billing?.loading)
  const suggested = suggestedBinderName(preset, { region: gen.region, setName: setChecklist?.scope.setName })
  const shownName = name ?? suggested
  const ready = Boolean(shownName.trim()) && (preset === "blank" || manifest.entries.length > 0) && (preset !== "set" || setChecklist)
  const grid = list ? null : size
  const capacity = (grid ?? size).rows * (grid ?? size).cols
  const pages = Math.max(1, Math.ceil(manifest.entries.length / capacity))
  const page = Math.min(previewPage, pages - 1)
  const summary = creationSummary(preset, manifest.entries.length, grid, { region: gen.region, setName: setChecklist?.scope.setName })
  const matches = query.trim().length < 2 || preset !== "species" ? [] : POKEMON_CATALOG.filter(p => `${p.id} ${p.name} ${formatPokemonDisplayName(p.name)}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 18)
  const choosePreset = (id: CreationPreset) => { setPreset(id); setQuery(""); setPreviewPage(0); setStep(2) }
  const create = async () => {
    if (blocked || busy || saved || !ready) return
    setBusy(true); setMessage("")
    try {
      // One draft per creation: a retry resends exactly this one.
      const prepared = draft ?? parseBinderCreationDraft({ version: 1, operationId: crypto.randomUUID(), ownerUserId: binding.ownerUserId, name: shownName, manifest,
        kind: list ? "custom" : "binder", location: list ? location : null, ...(preset === "set" && setChecklist ? { setChecklist } : {}) })
      setDraft(prepared)
      await binding.create(prepared, grid)
      setSaved(true)
    } catch (cause) {
      setMessage(cause instanceof Error && cause.message === "Invalid creation draft" ? "That name can't be used. Try a shorter name." : "Couldn't create this binder just now. Check your connection and try again. Your choices are kept.")
    } finally { setBusy(false) }
  }
  const entryArt = (index: number) => {
    const target = manifest.entries[index]?.target
    if (target?.kind === "pokemon") return { src: getOfficialArtworkUrl(target.pokemonId), card: false, label: speciesName(target.pokemonId) }
    if (target?.kind !== "card") return null
    const picked = preset === "printings" ? printings.filter(printingTarget)[index] : undefined
    const listed = preset === "set" ? setChecklist?.scope.cards.find(c => c.cardId === target.cardId) : undefined
    return { src: picked?.image ?? null, card: true, label: picked?.name ?? listed?.name ?? "Card", number: listed?.localId }
  }
  const title = saved ? "Binder created" : step === 1 ? "New binder" : step === 2 ? PRESETS.find(p => p.id === preset)!.title : "Preview"
  return createPortal(<div data-overlay-backdrop className="fixed inset-0 z-[42] bg-black/55 backdrop-blur-[2px]" onClick={onClose}>
    <div ref={sheet} role="dialog" aria-modal="true" aria-label="New binder" onClick={e => e.stopPropagation()}
      className="absolute inset-x-0 mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-t-[1.6rem] border border-border/70 bg-card shadow-xl sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:rounded-[1.6rem]"
      style={{ bottom: "var(--dock-clearance)", maxHeight: "calc(100dvh - var(--top-inset) - var(--dock-clearance) - 0.5rem)" }}>
      <header data-sheet-grabber className="shrink-0 px-4 pb-2 pt-2" {...swipe}>
        <div aria-hidden="true" className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {!saved && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Step {step} of 3</p>}
            <h2 className="truncate text-base font-semibold">{title}</h2>
          </div>
          <button type="button" aria-label="Close new binder" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-3">
        {capped && <p role="status" className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm">You&apos;ve reached the number of binders your plan allows. Your existing binders stay as they are.</p>}
        {!binding.available && !saved && !busy && <p role="status" className="rounded-2xl border border-border/60 bg-muted/40 p-3 text-sm">You need to be online, with your latest changes saved, to create a binder.</p>}
        {saved ? <div className="py-6 text-center">
          <p className="text-sm font-semibold">“{draft?.name}” is on its way</p>
          <p className="mt-1 text-sm text-muted-foreground">It opens as soon as it&apos;s saved to your account.</p>
        </div> : step === 1 ? <div className="grid grid-cols-2 gap-2" role="group" aria-label="What is this binder for?">
          {PRESETS.map(option => <button key={option.id} type="button" onClick={() => choosePreset(option.id)} aria-pressed={preset === option.id && (name !== null || step !== 1)}
            className="flex min-h-[8.5rem] flex-col items-center justify-between gap-2 rounded-2xl border border-border/60 bg-background/40 p-3 text-center transition-colors hover:border-primary/45 hover:bg-primary/5 active:scale-[0.98]">
            <PresetArt preset={option} />
            <span><span className="block text-sm font-semibold">{option.title}</span><span className="block text-xs text-muted-foreground">{option.line}</span></span>
          </button>)}
        </div> : step === 2 ? <>
          {preset === "set" && <SetPresetPicker isOnline={binding.available} onChange={value => { setSetChecklist(value); setPreviewPage(0) }} />}
          {preset === "generation" && <div role="group" aria-label="Generation" className="grid grid-cols-3 gap-1.5">
            {GENERATIONS.filter(g => g.id > 0).map(g => <button key={g.id} type="button" aria-pressed={generation === g.id} onClick={() => { setGeneration(g.id); setPreviewPage(0) }}
              className="flex min-h-12 flex-col items-center justify-center rounded-2xl border border-border/60 px-1 text-center aria-pressed:border-primary/50 aria-pressed:bg-primary/10">
              <span className="text-sm font-semibold">{g.region}</span><span className="text-[11px] text-muted-foreground">{g.end - g.start + 1} Pokémon</span>
            </button>)}
          </div>}
          {(preset === "species" || preset === "printings") && <>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="search" aria-label={preset === "species" ? "Find Pokémon" : "Find cards"} placeholder={preset === "species" ? "Pokémon name or number" : "Card name, set or number"} value={query} onChange={e => setQuery(e.target.value)} className={`${field} pl-9`} />
            </div>
            {preset === "species" && <>
              {matches.length > 0 && <div aria-label="Pokémon results" className="grid grid-cols-3 gap-1.5">{matches.map(p => <button key={p.id} type="button" aria-pressed={species.includes(p.id)}
                onClick={() => { setSpecies(previous => previous.includes(p.id) ? previous.filter(id => id !== p.id) : [...previous, p.id]); setPreviewPage(0) }}
                className="flex flex-col items-center rounded-2xl border border-border/60 p-1.5 text-center aria-pressed:border-primary/50 aria-pressed:bg-primary/10">
                <span className="relative h-12 w-12"><CardImage src={getOfficialArtworkUrl(p.id)} alt="" fill sizes="48px" className="object-contain" /></span>
                <span className="w-full truncate text-xs font-semibold">{formatPokemonDisplayName(p.name)}</span><span className="text-[10px] tabular-nums text-muted-foreground">{formatDexNumber(p.id)}</span>
              </button>)}</div>}
              {species.length > 0 && <div aria-label="Chosen Pokémon" className="flex flex-wrap gap-1.5">{species.map(id => <button key={id} type="button" aria-label={`Remove ${speciesName(id)}`} onClick={() => setSpecies(previous => previous.filter(p => p !== id))}
                className="flex min-h-9 items-center gap-1 rounded-full border border-border/60 bg-background/50 pl-1 pr-2 text-xs font-medium">
                <span className="relative h-7 w-7"><CardImage src={getOfficialArtworkUrl(id)} alt="" fill sizes="28px" className="object-contain" /></span>{speciesName(id)}<X className="h-3 w-3 text-muted-foreground" />
              </button>)}</div>}
              {!species.length && query.trim().length < 2 && <p className="text-sm text-muted-foreground">Search and tap the Pokémon you want pockets for. They&apos;re kept in the order you pick them.</p>}
            </>}
            {preset === "printings" && <>
              {search.loading && <p role="status" className="text-xs text-muted-foreground">Searching…</p>}
              {!search.loading && query.trim().length >= 2 && !search.cards.length && <p className="text-sm text-muted-foreground">No cards found. Try a different name, set or number.</p>}
              {search.cards.length > 0 && <div aria-label="Card results" className="grid grid-cols-3 gap-1.5">{search.cards.slice(0, 18).map(card => <button key={`${card.id}:${card.language}`} type="button" disabled={!printingTarget(card)}
                aria-label={`Add ${card.name} from ${card.set.name}`} onClick={() => { setPrintings(previous => [...previous, structuredClone(card)]); setPreviewPage(0) }}
                className="overflow-hidden rounded-xl border border-border/60 text-left disabled:opacity-40">
                <span className="trading-card relative block w-full bg-muted">{card.image && <CardImage src={card.image} alt="" fill sizes="120px" className="object-cover" />}</span>
                <span className="block truncate px-1.5 pt-1 text-[11px] font-semibold">{card.name}</span><span className="block truncate px-1.5 pb-1 text-[10px] text-muted-foreground">{card.set.name} · #{card.localId}</span>
              </button>)}</div>}
              {printings.length > 0 && <div aria-label="Chosen cards" className="flex gap-1.5 overflow-x-auto pb-1">{printings.map((card, index) => <button key={`${card.id}:${index}`} type="button" aria-label={`Remove ${card.name}`}
                onClick={() => setPrintings(previous => previous.filter((_, i) => i !== index))} className="trading-card relative w-11 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted">
                {card.image && <CardImage src={card.image} alt="" fill sizes="44px" className="object-cover" />}<span className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl bg-black/70 text-white"><X className="h-2.5 w-2.5" /></span>
              </button>)}</div>}
              {!printings.length && query.trim().length < 2 && <p className="text-sm text-muted-foreground">Search and tap each card you want a pocket for, in the order you want them.</p>}
            </>}
          </>}
          <label className="block text-sm font-medium">Name
            <input aria-label="Binder name" value={shownName} maxLength={BINDER_NAME_MAX_LENGTH} onChange={e => setName(e.target.value)} className={`${field} mt-1`} />
          </label>
          <div>
            <p className="text-sm font-medium">Looks like</p>
            <div role="group" aria-label="Looks like" className="mt-1 grid grid-cols-2 gap-1.5">
              <button type="button" aria-pressed={!list} onClick={() => setList(false)} className="min-h-11 rounded-2xl border border-border/60 text-sm font-medium aria-pressed:border-primary/50 aria-pressed:bg-primary/10">Binder pages</button>
              <button type="button" aria-pressed={list} onClick={() => setList(true)} className="min-h-11 rounded-2xl border border-border/60 text-sm font-medium aria-pressed:border-primary/50 aria-pressed:bg-primary/10">A simple list</button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{list ? "Good for a box, tin or shelf. " : ""}You can switch between pages and a list any time.</p>
          </div>
          {list ? <label className="block text-sm font-medium">Where is it kept? <span className="font-normal text-muted-foreground">(optional)</span>
            <input aria-label="Where it is kept" value={location} maxLength={COLLECTION_CREATION_LIMITS.location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Top shelf" className={`${field} mt-1`} />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">Only you and your partner see this. It&apos;s never on a shared link.</span>
          </label> : <div>
            <p className="text-sm font-medium">Pockets on a page</p>
            <div role="group" aria-label="Pockets on a page" className="mt-1 grid grid-cols-4 gap-1.5">
              {FREE_PAGE_SIZES.map(option => <button key={`${option.rows}x${option.cols}`} type="button" aria-pressed={size === option} aria-label={pageSizeLabel(option)} onClick={() => { setSize(option); setPreviewPage(0) }}
                className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl border border-border/60 aria-pressed:border-primary/50 aria-pressed:bg-primary/10">
                <span className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${option.cols}, 0.4rem)` }} aria-hidden="true">{Array.from({ length: option.rows * option.cols }, (_, i) => <span key={i} className="h-[0.55rem] rounded-[1px] bg-muted-foreground/55" />)}</span>
                <span className="text-xs font-semibold tabular-nums">{option.rows * option.cols}</span>
              </button>)}
            </div>
          </div>}
        </> : <>
          <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{shownName.trim()}</p>
          <p className="-mt-2 text-sm text-muted-foreground">{summary}</p>
          {manifest.entries.length === 0 ? <div className="rounded-2xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">Starts empty. Add pockets and cards whenever you like.</div>
            : <section aria-label={`Page ${page + 1} preview`} className="rounded-2xl border border-white/15 bg-gradient-to-br from-slate-200 to-slate-300 p-2 shadow-inner dark:from-slate-700 dark:to-slate-800">
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${list ? 4 : size.cols}, minmax(0, 1fr))` }}>
                {Array.from({ length: capacity }, (_, offset) => {
                  const art = entryArt(page * capacity + offset)
                  return <div key={offset} className="trading-card relative flex items-center justify-center overflow-hidden rounded-[5px] border border-black/10 bg-white/55 dark:border-white/10 dark:bg-white/[0.06]" title={art?.label}>
                    {art?.src ? <CardImage src={art.src} alt={art.label} fill sizes="80px" className={art.card ? "object-cover" : "object-contain p-[3px] opacity-60 grayscale"} />
                      : art ? <span className="px-0.5 text-center text-[9px] font-medium leading-tight text-slate-700 dark:text-slate-200">{art.number ? `#${art.number} ` : ""}{art.label}</span> : null}
                  </div>
                })}
              </div>
            </section>}
          {pages > 1 && <div className="flex items-center justify-between gap-2">
            <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPreviewPage(page - 1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-xs tabular-nums text-muted-foreground">Page {page + 1} of {pages}</span>
            <button type="button" aria-label="Next page" disabled={page + 1 === pages} onClick={() => setPreviewPage(page + 1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>}
          <p className="text-xs text-muted-foreground">{manifest.entries.length ? "These pockets start empty. Nothing is added to the cards you own." : "Nothing is added to the cards you own."}</p>
          {message && <p role="alert" className="text-sm">{message}</p>}
        </>}
      </div>
      <footer className="flex shrink-0 gap-2 border-t border-border/60 p-3">
        {saved ? <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground">Done</button> : <>
          {step > 1 && !draft && <button type="button" onClick={() => setStep(step === 3 ? 2 : 1)} className="min-h-11 rounded-2xl border border-border/60 px-4 text-sm font-medium">Back</button>}
          {step === 1 ? <button type="button" onClick={() => setStep(2)} className="min-h-11 flex-1 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground">Next</button>
            : step === 2 ? <button type="button" disabled={!ready} onClick={() => setStep(3)} className="min-h-11 flex-1 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-45">Preview</button>
            : <button type="button" disabled={blocked || busy || !ready} onClick={() => void create()} className="min-h-11 flex-1 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-45">{busy ? "Creating…" : draft ? "Try again" : "Create binder"}</button>}
        </>}
      </footer>
    </div>
  </div>, document.body)
}
