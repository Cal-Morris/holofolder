"use client"

import Image from "next/image"
import { Check } from "lucide-react"
import { useState } from "react"
import { nativeCardConsumers, nativeWantSelections, prepareNativeWant, type NativeConsumerBinding } from "@/lib/collection/native-card-consumers"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { toCardImageSrc } from "@/lib/card-image-url"
import { formatCardFinishLabel, formatCardLanguageLabel } from "@/lib/card-labels"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import type { CardFinish } from "@/lib/domain/cards"

/** Explicit wanted entries, not species groups or a second inventory store. Used by Wanted, Hunting and card details. */
export default function NativeWantedEntries({ binding, card, finish, onCheck, presentation = "lookup" }: {
  presentation?: "lookup" | "wanted"
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
  const noticeEl = notice && <p role="status" className={isWanted ? "sticky top-2 z-10 break-words rounded-xl border border-border/60 bg-card px-3 py-2 text-sm shadow-sm" : "break-words text-sm"}>{notice}</p>
  return <section aria-label={title} className={isWanted ? "mx-auto w-full max-w-6xl space-y-3 p-3 sm:p-4" : "space-y-3 p-3"}>
    {isWanted ? <>
      <h1 className="text-xl font-bold tracking-tight">Wanted</h1>
      <p className="text-sm text-muted-foreground">{entries.length} wanted {entries.length === 1 ? "card" : "cards"}</p>
    </> : <h3 className="text-sm font-bold">{title} · {entries.length} {entries.length === 1 ? "card" : "cards"}</h3>}
    {model?.kind === "cached" ? <p className="text-sm text-muted-foreground">Saved wanted cards, read-only while offline.</p> : !model ? <p role="status" className="text-sm text-muted-foreground">Could not load wanted cards. Reconnect and try again.</p> : null}
    {!entries.length && model && <p className="text-sm text-muted-foreground">{card ? "Not on your want list" : "No wanted cards yet"}</p>}
    {isWanted && noticeEl}
    {entries.length > 0 && <div role="list" className={isWanted ? "grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3" : "divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-card/85 dark:divide-white/10 dark:border-white/10 dark:bg-card/70"}>
    {entries.map(entry => {
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
      const destinationLabel = `${position} · Wanted card ${entry.destination.wantedIndex + 1}`
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
                {/* An owned pocket with an upgrade want is normal. Same Owned pill as the collection slot list; the add controls below stay hidden for it. */}
                {entry.occupied && <span title="This pocket already holds a copy" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-400/12 px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300"><Check className="h-3 w-3" aria-hidden="true" />Owned</span>}
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
