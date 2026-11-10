"use client"

import { useState } from "react"
import { nativeCardConsumers, nativeWantSelections, prepareNativeWant, type NativeConsumerBinding } from "@/lib/collection/native-card-consumers"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { formatCardFinishLabel } from "@/lib/card-labels"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import type { CardFinish } from "@/lib/domain/cards"

/** Explicit entries, not species groups or a second inventory store. Used by hunt and lookup details. */
export default function NativeWantedEntries({ binding, card, finish, onCheck }: {
  binding: NativeConsumerBinding
  card?: SearchCardResult
  finish?: CardFinish
  onCheck?: (card: SearchCardResult, finish?: CardFinish) => void
}) {
  const model = nativeCardConsumers(binding)
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const entries = model?.wants.filter(w => !card || w.card && matchesCatalogCardId(card, w.card.canonicalId ?? w.card.id)
    && w.card.language === card.language && (!finish || w.finish === finish)) ?? []
  return <section aria-label="Native wanted destinations" className="space-y-3 p-3">
    <h3 className="text-sm font-bold">{card ? "Wanted destinations" : "Hunting"} · {entries.length} explicit entries</h3>
    <p className="text-xs text-muted-foreground">{model?.kind === "cached" ? "Cached only, read-only" : model ? "Saved storage evidence" : "Storage evidence unavailable"}</p>
    {!card && model && <p className="text-xs text-muted-foreground">{model.projection.owned.length} physical {model.projection.owned.length === 1 ? "copy" : "copies"} · {model.projection.owned.filter(c => c.placement === null).length} Unassigned · {model.copies.filter(c => !c.card || !c.finish).length} Unknown exact printing</p>}
    {!entries.length && <p className="text-sm text-muted-foreground">No explicit wanted entries in this scope.</p>}
    {entries.map(entry => {
      const choices = nativeWantSelections(model, entry.destination)
      const key = JSON.stringify(entry.destination)
      const value = selected[key] ?? ""
      const known = entry.card && entry.finish && entry.card.language
      return <div key={key} className="min-w-0 space-y-2 rounded-2xl border border-border/60 p-3">
        <p className="break-words text-sm font-semibold">{entry.card?.name ?? "Unknown exact printing"}{entry.finish ? ` · ${formatCardFinishLabel(entry.finish)}` : " · Unknown finish"}</p>
        <p className="break-all text-xs text-muted-foreground">{entry.collectionName} · {entry.destination.slotId} · wanted entry {entry.destination.wantedIndex + 1}</p>
        {entry.card && onCheck && <button type="button" className="min-h-9 rounded-xl border px-3 text-sm" onClick={() => onCheck(entry.card!, entry.finish ?? undefined)}>Check price</button>}
        {entry.occupied && <p className="text-xs text-muted-foreground">Slot occupied, choose another destination in storage.</p>}
        {known && !entry.occupied && model?.kind === "complete" && binding.editingAvailable && <>
          <select aria-label={`Copy for ${entry.destination.slotId} wanted entry ${entry.destination.wantedIndex + 1}`} className="min-h-9 w-full min-w-0 rounded-xl border bg-card px-2 text-sm" value={value} disabled={busy} onChange={e => setSelected(s => ({ ...s, [key]: e.target.value }))}>
            <option value="">Choose a copy</option>
            {choices.length ? choices.map(c => <option key={c.selection.inventoryItemId} value={c.selection.inventoryItemId}>{c.label}</option>) : <option value="new">Add a new raw copy</option>}
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
              setNotice(accepted?.status === "saved-on-device" ? "Saved on device, awaiting sync" : "Draft handed to host, not confirmed saved")
            } catch (error) { setNotice(error instanceof Error ? error.message : "Could not prepare this destination") }
            finally { setBusy(false) }
          }}>Use this wanted destination</button>
        </>}
      </div>
    })}
    {notice && <p role="status" className="break-words text-sm">{notice}</p>}
  </section>
}
