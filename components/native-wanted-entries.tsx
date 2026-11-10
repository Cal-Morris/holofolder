"use client"

import Image from "next/image"
import { useState } from "react"
import { nativeCardConsumers, nativeWantSelections, prepareNativeWant, type NativeConsumerBinding } from "@/lib/collection/native-card-consumers"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { toCardImageSrc } from "@/lib/card-image-url"
import { formatCardFinishLabel, formatCardLanguageLabel } from "@/lib/card-labels"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import type { CardFinish } from "@/lib/domain/cards"

/** Explicit entries, not species groups or a second inventory store. Used by hunt and lookup details. */
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
  return <section aria-label={isWanted ? "Wanted cards" : "Native wanted destinations"} className="space-y-3 p-3">
    {isWanted ? <>
      <h1 className="text-xl font-bold tracking-tight">Wanted</h1>
      <p className="text-sm text-muted-foreground">{entries.length} wanted {entries.length === 1 ? "card" : "cards"}</p>
      {model?.kind === "cached" ? <p className="text-sm text-muted-foreground">Saved wanted cards, read-only while offline.</p> : !model ? <p role="status" className="text-sm text-muted-foreground">Could not load wanted cards. Reconnect and try again.</p> : null}
    </> : <>
      <h3 className="text-sm font-bold">{card ? "Wanted destinations" : "Hunting"} · {entries.length} explicit entries</h3>
      <p className="text-xs text-muted-foreground">{model?.kind === "cached" ? "Cached only, read-only" : model ? "Saved storage evidence" : "Storage evidence unavailable"}</p>
      {!card && model && <p className="text-xs text-muted-foreground">{model.projection.owned.length} physical {model.projection.owned.length === 1 ? "copy" : "copies"} · {model.projection.owned.filter(c => c.placement === null).length} Unassigned · {model.copies.filter(c => !c.card || !c.finish).length} Unknown exact printing</p>}
    </>}
    {!entries.length && (!isWanted || model) && <p className="text-sm text-muted-foreground">{isWanted ? "No wanted cards yet" : "No explicit wanted entries in this scope."}</p>}
    <div role={isWanted ? "list" : undefined} className={isWanted ? "divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-card/85 dark:divide-white/10 dark:border-white/10 dark:bg-card/70" : "space-y-3"}>
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
      const destinationLabel = isWanted ? `${position} · Wanted card ${entry.destination.wantedIndex + 1}` : `${entry.destination.slotId} wanted entry ${entry.destination.wantedIndex + 1}`
      return <div key={key} role={isWanted ? "listitem" : undefined} className={isWanted ? "min-w-0 space-y-2 p-3" : "min-w-0 space-y-2 rounded-2xl border border-border/60 p-3"}>
        {isWanted ? <>
          <div className="flex min-h-14 min-w-0 items-center gap-3 text-left">
            <span className="trading-card relative w-11 shrink-0 border border-border/55 bg-muted dark:border-white/10">
              {artwork && entry.card && <Image src={artwork} alt={entry.card.name} fill sizes="44px" unoptimized className="object-cover" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{entry.card?.name ?? "Unknown card"}</p>
              <p className="truncate text-xs text-muted-foreground">{[entry.card?.set.name, entry.card?.localId ? `#${entry.card.localId}` : null].filter(Boolean).join(" · ") || "Unknown set"}</p>
              <p className="truncate text-[11px] text-muted-foreground/90">{[entry.finish ? formatCardFinishLabel(entry.finish) : "Unknown finish", entry.card?.language && entry.card.language !== "en" ? formatCardLanguageLabel(entry.card.language) : null].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <p className="break-words text-xs text-muted-foreground">{entry.collectionName} · {destinationLabel}</p>
        </> : <>
        <p className="break-words text-sm font-semibold">{entry.card?.name ?? "Unknown exact printing"}{entry.finish ? ` · ${formatCardFinishLabel(entry.finish)}` : " · Unknown finish"}</p>
        <p className="break-all text-xs text-muted-foreground">{entry.collectionName} · {entry.destination.slotId} · wanted entry {entry.destination.wantedIndex + 1}</p>
        </>}
        <div className={isWanted ? "flex flex-wrap items-center gap-2" : "space-y-2"}>
        {entry.card && onCheck && <button type="button" className="min-h-9 rounded-xl border px-3 text-sm" onClick={() => onCheck(entry.card!, entry.finish ?? undefined)}>Check price</button>}
        {entry.occupied && <p className="text-xs text-muted-foreground">{isWanted ? "This pocket is occupied. Choose another pocket in your collection." : "Slot occupied, choose another destination in storage."}</p>}
        {known && !entry.occupied && model?.kind === "complete" && binding.editingAvailable && <>
          <select aria-label={`Copy for ${destinationLabel}`} className={`min-h-9 rounded-xl border bg-card px-2 text-sm ${isWanted ? "min-w-36 flex-1 md:max-w-xs" : "w-full min-w-0"}`} value={value} disabled={busy} onChange={e => setSelected(s => ({ ...s, [key]: e.target.value }))}>
            <option value="">Choose a copy</option>
            {choices.length ? choices.map((c, index) => <option key={c.selection.inventoryItemId} value={c.selection.inventoryItemId}>{isWanted ? `Unassigned copy ${index + 1}` : c.label}</option>) : <option value="new">{isWanted ? "New copy" : "Add a new raw copy"}</option>}
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
              setNotice(accepted?.status === "saved-on-device" ? "Saved on device, awaiting sync" : isWanted ? "Could not confirm this change. Check your collection before trying again." : "Draft handed to host, not confirmed saved")
            } catch (error) { setNotice(error instanceof Error ? error.message : "Could not prepare this destination") }
            finally { setBusy(false) }
          }}>{isWanted ? "Add to collection" : "Use this wanted destination"}</button>
        </>}
        </div>
      </div>
    })}
    </div>
    {notice && <p role="status" className="break-words text-sm">{notice}</p>}
  </section>
}
