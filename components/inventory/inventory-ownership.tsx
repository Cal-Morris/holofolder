"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import CardImage from "@/components/card-image"
import CardPickerSheet, { cardPickerSheetChoice } from "@/components/card-picker-sheet"
import { CardSelector } from "@/components/binder/lazy-views"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { formatCardFinishLabel } from "@/lib/card-labels"
import { isCardLanguage, type CardFinish } from "@/lib/domain/cards"
import type { InventoryCatalogResolver, InventoryIdentity, InventorySnapshot } from "@/lib/domain/inventory"
import type { SlotTarget } from "@/lib/domain/binder-slots"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import { pickerCandidate } from "@/lib/slot-picker"
import { slotDraftFailureMessage } from "@/lib/slot-draft-failure"
import { formatGradeLabel } from "@/lib/pocket-labels"
import { inventoryActionDestinations, inventoryOccupiedChoices, prepareInventoryAction, type InventoryAction, type InventoryOwnershipBinding } from "@/lib/inventory-actions"
import { prepareInventoryBulkAction, type InventoryBulkAction } from "@/lib/inventory-bulk-actions"
import styles from "./inventory.module.css"

/** How Inventory names things for people: a pocket by its binder, page and pocket, a card by its name and printing. */
export interface InventoryLabels {
  place: (collectionId: string, slotId: string) => string
  card: (identity: InventoryIdentity | SlotTarget) => { name: string; detail: string; image?: string }
}

const context = () => ({ source: "app" as const, clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() })
const unusedLegacySelect = () => {}
const primary = "min-h-11 flex-1 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-45"
const secondary = "min-h-11 rounded-2xl border border-border/70 px-4 text-sm font-medium disabled:opacity-45"

/**
 * One Inventory change: prepared once from the current read and handed to the durable host. A failed handoff keeps
 * that exact prepared change, so Try again resends it and nothing is prepared twice.
 */
export function useInventorySave(binding: InventoryOwnershipBinding, onAccepted: () => void) {
  const [draft, setDraft] = useState<(ReturnType<typeof prepareInventoryAction> & { catalog: InventoryCatalogResolver }) | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const lock = useRef(false), alive = useRef(false)
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const submit = async (prepared: NonNullable<typeof draft>) => {
    if (lock.current || !binding.available) return
    lock.current = true; setBusy(true); setError("")
    try {
      const receipt = await binding.receive(prepared.intent, prepared.catalog)
      if (receipt.status !== "saved-on-device" || receipt.operationId !== prepared.intent.request.operationId) throw new Error("invalid-local-acceptance")
      if (alive.current) onAccepted()
    } catch (cause) {
      if (alive.current) setError(slotDraftFailureMessage(cause))
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  const run = (action: InventoryAction | InventoryBulkAction, catalog = binding.catalog) => {
    if (lock.current || !binding.available || draft) return
    try {
      const prepared = { ...(action.kind === "move" || "itemIds" in action ? prepareInventoryBulkAction(binding.snapshot, action, context(), catalog) : prepareInventoryAction(binding.snapshot, action, context(), catalog)), catalog }
      setDraft(prepared)
      void submit(prepared)
    } catch { setError("This card or pocket changed while this was open. Close this and try again. Nothing was changed.") }
  }
  return { busy, error, pending: draft !== null && !busy && error !== "", run, retry: () => { if (draft) void submit(draft) },
    discard: () => { if (!lock.current) { setDraft(null); setError("") } } }
}

function SaveProblem({ save }: { save: ReturnType<typeof useInventorySave> }) {
  if (!save.error) return null
  return <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
    <p className="break-words">{save.error}</p>
    <div className="mt-2 flex gap-2">
      {save.pending && <button type="button" className={secondary} disabled={save.busy} onClick={save.retry}>Try again</button>}
      <button type="button" className="min-h-11 px-3 text-sm text-muted-foreground" disabled={save.busy} onClick={save.discard}>Dismiss</button>
    </div>
  </div>
}

function itemLabel(snapshot: InventorySnapshot, labels: InventoryLabels, itemId: string) {
  const item = snapshot.items.find(i => i.id === itemId)
  if (!item) return { name: "Card", detail: "", image: undefined as string | undefined }
  const card = labels.card(item.identity)
  return { ...card, detail: [card.detail, item.grading ? formatGradeLabel(item.grading) : null].filter(Boolean).join(" · ") }
}

/**
 * Choose where one card goes: its binder, page and pocket, with what is there now. Putting a card where another
 * already sits always asks what happens to that other card before anything is saved.
 */
export function InventoryMove({ binding, labels, itemId, onAccepted, onCancel }: { binding: InventoryOwnershipBinding; labels: InventoryLabels; itemId: string; onAccepted: () => void; onCancel: () => void }) {
  const save = useInventorySave(binding, onAccepted)
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const [slotId, setSlotId] = useState<string | null>(null)
  const destinations = inventoryActionDestinations(binding.snapshot, itemId, binding.catalog)
  const collections = binding.snapshot.collections.filter(c => destinations.some(d => d.collectionId === c.id))
  const shownCollection = collectionId ?? collections[0]?.id ?? null
  const inCollection = destinations.filter(d => d.collectionId === shownCollection)
  const chosen = destinations.find(d => d.slot.id === slotId && d.collectionId === shownCollection)
  const choices = chosen ? inventoryOccupiedChoices(binding.snapshot, itemId, chosen, binding.catalog) : []
  const mine = itemLabel(binding.snapshot, labels, itemId)
  const occupant = chosen?.slot.inventoryItemId ? itemLabel(binding.snapshot, labels, chosen.slot.inventoryItemId) : null
  const place = (d: typeof destinations[number]) => labels.place(d.collectionId, d.slot.id).replace(/^.*? · /, "")
  const move = (occupied?: "unassign" | "swap") => { if (chosen) save.run({ kind: "place", itemId, collectionId: chosen.collectionId, slotId: chosen.slot.id, ...(occupied ? { occupied } : {}) }) }
  return <section aria-label="Move card" className="space-y-3">
    <SaveProblem save={save} />
    {!destinations.length ? <p className="text-sm text-muted-foreground">There&apos;s no pocket this card fits right now. Add a pocket for it in a binder, then move it there.</p> : chosen ? <>
      <p className="text-sm"><span className="font-semibold">{mine.name}</span> goes to <span className="font-semibold">{labels.place(chosen.collectionId, chosen.slot.id)}</span>.</p>
      {occupant && <div className="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-2.5">
        {occupant.image && <span className="trading-card relative w-9 shrink-0 overflow-hidden rounded bg-muted"><CardImage src={occupant.image} alt="" fill sizes="36px" className="object-cover" /></span>}
        <p className="min-w-0 text-sm"><span className="font-semibold">{occupant.name}</span> is in that pocket. What should happen to it?</p>
      </div>}
      {occupant ? <div className="grid gap-2">
        {choices.includes("swap") && <button type="button" className={cardPickerSheetChoice(true)} disabled={save.busy} onClick={() => move("swap")}><span>Swap them</span><span className="text-xs font-medium text-muted-foreground">They trade pockets</span></button>}
        {choices.includes("unassign") && <button type="button" className={cardPickerSheetChoice()} disabled={save.busy} onClick={() => move("unassign")}><span>Take {occupant.name} out</span><span className="text-xs font-medium text-muted-foreground">Stays in your collection</span></button>}
        {!choices.length && <p className="text-sm text-muted-foreground">That pocket can&apos;t take this card right now. Pick another pocket.</p>}
      </div> : <div className="flex gap-2"><button type="button" className={primary} disabled={save.busy} onClick={() => move()}>{save.busy ? "Moving…" : "Move here"}</button></div>}
      <button type="button" className={secondary} disabled={save.busy} onClick={() => setSlotId(null)}>Choose another pocket</button>
    </> : <>
      {collections.length > 1 && <div role="group" aria-label="Binder" className="flex gap-1.5 overflow-x-auto pb-1">
        {collections.map(c => <button key={c.id} type="button" aria-pressed={c.id === shownCollection} onClick={() => setCollectionId(c.id)}
          className="min-h-9 shrink-0 rounded-full border border-border/60 px-3 text-xs font-semibold aria-pressed:border-primary/50 aria-pressed:bg-primary/10">{c.name}</button>)}
      </div>}
      <ul aria-label="Pockets this card fits" className="grid max-h-[40dvh] gap-1.5 overflow-y-auto overscroll-contain">
        {inCollection.map(d => {
          const there = d.slot.inventoryItemId ? itemLabel(binding.snapshot, labels, d.slot.inventoryItemId) : null
          return <li key={d.slot.id}><button type="button" onClick={() => setSlotId(d.slot.id)} className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-border/60 px-3 py-1.5 text-left hover:bg-muted/60">
            <span className="trading-card relative w-8 shrink-0 overflow-hidden rounded border border-dashed border-border bg-muted/40">{there?.image && <CardImage src={there.image} alt="" fill sizes="32px" className="object-cover" />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{place(d)}</span><span className="block truncate text-xs text-muted-foreground">{there ? `Has ${there.name}` : "Empty"}</span></span>
          </button></li>
        })}
      </ul>
    </>}
    <button type="button" className={secondary} disabled={save.busy} onClick={onCancel}>Cancel</button>
  </section>
}

/** Add a card you own with the same visual selector as a binder pocket. It joins your collection, not a pocket. */
export function InventoryAddOwned({ binding, onClose, onInspect }: { binding: InventoryOwnershipBinding; labels?: InventoryLabels; onClose: () => void; onInspect: (itemId: string) => void }) {
  const save = useInventorySave(binding, onClose)
  const [picked, setPicked] = useState<{ card: SearchCardResult; finish: CardFinish | undefined } | null>(null)
  const add = ({ card, finish }: NonNullable<typeof picked>) => {
    const candidate = pickerCandidate(card)
    const resolve: InventoryCatalogResolver = id => matchesCatalogCardId(card, id) ? candidate : binding.catalog(id)
    save.run({ kind: "add", itemId: crypto.randomUUID(), identity: { kind: "card", cardId: card.canonicalId ?? card.id,
      ...(isCardLanguage(card.language) ? { language: card.language } : {}), ...(finish ? { finish } : {}) } }, resolve)
  }
  const duplicates = picked ? binding.snapshot.items.filter(i => i.identity.kind === "card" && matchesCatalogCardId(picked.card, i.identity.cardId)) : []
  return <>
    <CardSelector pokemonId={0} pokemonName="" onSelect={unusedLegacySelect} onClose={onClose} anyCard={{ title: "Add a card you own" }}
      native={{ onPick: (card, finish) => {
        const next = { card: { ...card, dexIds: card.dexIds ?? [] } as SearchCardResult, finish }
        setPicked(next)
        // A card you already have is a deliberate second copy, so that one is asked first.
        if (!binding.snapshot.items.some(i => i.identity.kind === "card" && matchesCatalogCardId(next.card, i.identity.cardId))) add(next)
      } }} />
    {picked && (duplicates.length > 0 || save.error) && <CardPickerSheet title={save.error ? "Couldn't add this card" : "You already have this card"} subtitle={`${picked.card.name} · ${picked.card.set.name}`}
      onClose={() => { save.discard(); setPicked(null) }}>
      {save.error ? <SaveProblem save={save} /> : <>
        <p className="mb-3 text-sm text-muted-foreground">You own {duplicates.length === 1 ? "one copy" : `${duplicates.length} copies`} of this card{picked.finish ? ` (adding ${formatCardFinishLabel(picked.finish)})` : ""}. Adding it again keeps each copy separate.</p>
        <div className="grid gap-2">
          <button type="button" className={cardPickerSheetChoice(true)} disabled={save.busy} onClick={() => add(picked)}>{save.busy ? "Adding…" : "Add another copy"}</button>
          <button type="button" className={cardPickerSheetChoice()} disabled={save.busy} onClick={() => onInspect(duplicates[0].id)}>Show the one I have</button>
        </div>
      </>}
    </CardPickerSheet>}
  </>
}

/** Move several selected cards at once: each to a pocket you choose for it, or all out of their binders. */
export function InventoryBulkReview({ binding, labels, itemIds, onClose, onAccepted }: { binding: InventoryOwnershipBinding; labels: InventoryLabels; itemIds: readonly string[]; onClose: () => void; onAccepted: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const save = useInventorySave(binding, onAccepted)
  const placed = (id: string) => binding.snapshot.placements.find(p => p.inventoryItemId === id)
  const allPlaced = itemIds.every(id => placed(id))
  const allMapped = itemIds.every(id => mapping[id])
  return <div className={styles.overlay}>
    <div data-overlay-backdrop className={styles.backdrop} onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Move selected cards" className={styles.sheet} tabIndex={-1}>
      <header {...swipe} data-sheet-grabber className={styles.sheetHeader}><h2>Move {itemIds.length} {itemIds.length === 1 ? "card" : "cards"}</h2><button type="button" aria-label="Close" onClick={onClose}><X size={20} /></button></header>
      <div className={`${styles.sheetBody} space-y-3`}>
        <SaveProblem save={save} />
        <fieldset disabled={!binding.available || save.busy} className="grid gap-2 border-0 p-0">
          {itemIds.map(id => {
            const card = itemLabel(binding.snapshot, labels, id), at = placed(id)
            return <div key={id} className="flex items-center gap-3 rounded-2xl border border-border/60 p-2">
              {card.image && <span className="trading-card relative w-9 shrink-0 overflow-hidden rounded bg-muted"><CardImage src={card.image} alt="" fill sizes="36px" className="object-cover" /></span>}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-semibold">{card.name}</p>
                <p className="truncate text-xs text-muted-foreground">{at ? labels.place(at.collectionId, at.slotId) : "Not in a binder"}</p>
                <select aria-label={`Pocket for ${card.name}`} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-base md:text-sm" value={mapping[id] ?? ""} onChange={e => setMapping(m => ({ ...m, [id]: e.target.value }))}>
                  <option value="">Choose an empty pocket</option>
                  {inventoryActionDestinations(binding.snapshot, id, binding.catalog).filter(d => d.slot.inventoryItemId === null).map(d => {
                    const key = JSON.stringify([d.collectionId, d.slot.id])
                    return <option key={key} value={key} disabled={itemIds.some(other => other !== id && mapping[other] === key)}>{labels.place(d.collectionId, d.slot.id)}</option>
                  })}
                </select>
              </div>
            </div>
          })}
        </fieldset>
        <p className="text-xs text-muted-foreground">Each card moves to the empty pocket you choose. The pockets they leave stay where they are, empty.</p>
      </div>
      <footer className="flex shrink-0 flex-wrap gap-2 border-t border-border p-3">
        <button type="button" className={primary} disabled={!allMapped || save.busy || !binding.available} onClick={() => save.run({ kind: "move", mapping: itemIds.map(itemId => {
          const [collectionId, slotId] = JSON.parse(mapping[itemId]) as [string, string]
          return { itemId, collectionId, slotId }
        }) })}>{save.busy ? "Moving…" : `Move ${itemIds.length === 1 ? "card" : "cards"}`}</button>
        {allPlaced && <button type="button" className={secondary} disabled={save.busy || !binding.available} onClick={() => save.run({ kind: "unassign", itemIds })}>Take out of binders</button>}
      </footer>
    </div>
  </div>
}
