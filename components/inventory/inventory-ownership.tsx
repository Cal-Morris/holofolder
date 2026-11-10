"use client"

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import SlotCatalogSearch from "@/components/binder/slot-catalog-search"
import { useCardSearch } from "@/hooks/use-card-search"
import { buildOfflineCardIndex } from "@/lib/offline-card-index"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { isCardLanguage, type CardFinish, type CardLanguage } from "@/lib/domain/cards"
import type { InventoryCatalogResolver } from "@/lib/domain/inventory"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import { pickerCandidate, pickerFinishes } from "@/lib/slot-picker"
import { inventoryActionDestinations, inventoryActionItemRef, prepareInventoryAction, type InventoryAction, type InventoryOwnershipBinding } from "@/lib/inventory-actions"
import styles from "./inventory.module.css"

const context = () => ({ source: "app" as const, clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() })

/** Immutable review survives local commit failure. Accepted intent belongs to the durable host. */
function useActionReview(binding: InventoryOwnershipBinding, onAccepted: () => void) {
  const [draft, setDraft] = useState<(ReturnType<typeof prepareInventoryAction> & { catalog: InventoryCatalogResolver }) | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const lock = useRef(false), alive = useRef(false)
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const review = (action: InventoryAction, catalog = binding.catalog) => {
    if (lock.current || !binding.available || draft) return
    try { setDraft({ ...prepareInventoryAction(binding.snapshot, action, context(), catalog), catalog }); setError("") }
    catch { setError("This copy or destination is unavailable. Refresh current Inventory before trying again.") }
  }
  const submit = async () => {
    if (lock.current || !draft || !binding.available) return
    lock.current = true; setBusy(true); setError("")
    try {
      const receipt = await binding.receive(draft.intent, draft.catalog)
      if (receipt.status !== "saved-on-device" || receipt.operationId !== draft.intent.request.operationId) throw new Error("invalid-local-acceptance")
      if (alive.current) onAccepted()
    } catch {
      if (alive.current) setError("Could not confirm saving on this device. Retry this same request after checking current storage. Accepted requests remain on this device even if you close this sheet.")
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  return { draft, error, busy, review, submit, cancel: () => { if (!lock.current) { setDraft(null); setError("") } } }
}

function Confirmation({ review, children, details }: { review: ReturnType<typeof useActionReview>; children: ReactNode; details?: ReactNode }) {
  return <section aria-label="Review ownership change" className={styles.actionReview}>
    {children}
    <div className={styles.actions}><button type="button" disabled={review.busy} onClick={() => void review.submit()}>{review.busy ? "Saving on device…" : "Confirm change"}</button>
      <button type="button" disabled={review.busy} onClick={review.cancel}>Cancel change</button></div>
    <p>Saved on this device first. Sync and Activity history are confirmed separately.</p>
    {details}
  </section>
}

export function InventoryCopyActions({ binding, itemId, onAccepted }: { binding: InventoryOwnershipBinding; itemId: string; onAccepted: () => void }) {
  const [placing, setPlacing] = useState(false)
  const [destination, setDestination] = useState("")
  const review = useActionReview(binding, onAccepted)
  const item = binding.snapshot.items.find(i => i.id === itemId)
  if (!item || item.grading !== null) return null
  const ref = inventoryActionItemRef(binding.snapshot, itemId)
  const destinations = inventoryActionDestinations(binding.snapshot, itemId, binding.catalog)
  const command = review.draft?.intent.request.commands[0]
  const source = ref.placement
  const location = source ? `${binding.snapshot.collections.find(c => c.id === source.collectionId)?.name ?? "Storage"}, slot ${source.slot.id}` : "Unassigned"
  return <section aria-label="Raw copy ownership" className={styles.ownership}>
    {review.error && <p role="alert">{review.error}</p>}
    {command ? <Confirmation review={review} details={command.kind === "removeOwned" ? <p>After sync, open Activity to review recovery of this exact copy and its saved metadata. Recovery checks current versions; if the former slot is occupied, explicitly choose Unassigned. Recovery may be unavailable if history or current permissions cannot be verified.</p> : undefined}>
      <h3>{command.kind === "removeOwned" ? "Remove this owned copy?" : command.kind === "unassign" ? "Keep this copy Unassigned?" : "Place this exact copy?"}</h3>
      <p>Copy {itemId} · {location}</p>
      {command.kind === "removeOwned" ? <p>Ownership decreases by one. {source ? "Its placement is cleared. The former slot, target, wants and order remain." : "No storage slot changes."} Other copies stay unchanged.</p>
        : command.kind === "unassign" ? <p>Ownership stays unchanged. The former slot becomes unfilled; its target, wants and order remain.</p>
          : "destination" in command && <><p>Destination: {binding.snapshot.collections.find(c => c.id === command.destination.collectionId)?.name}, slot {command.destination.slot.id}.</p>
            <p>Ownership stays unchanged. {source ? "The former slot becomes unfilled. " : ""}Targets, wants and slot order stay unchanged. No other copy is moved.</p></>}
    </Confirmation> : <fieldset disabled={!binding.available} className={styles.actions}>
      {placing ? <>
        <label className={styles.field}>Compatible empty slot<select aria-label="Compatible empty slot" value={destination} onChange={e => setDestination(e.target.value)}>
          <option value="">Choose a destination</option>{destinations.map(d => <option key={d.slot.id} value={d.slot.id}>{binding.snapshot.collections.find(c => c.id === d.collectionId)?.name} · Slot {d.slot.id}</option>)}
        </select></label>
        {!destinations.length && <p>No compatible empty slots are available. Occupied slots require a separate displacement decision and are not offered here.</p>}
        <button type="button" disabled={!destination} onClick={() => { const d = destinations.find(s => s.slot.id === destination); if (d) review.review({ kind: "place", itemId, collectionId: d.collectionId, slotId: d.slot.id }) }}>Review placement</button>
        <button type="button" onClick={() => setPlacing(false)}>Cancel placement</button>
      </> : <>
        <button type="button" onClick={() => setPlacing(true)}>{source ? "Move copy" : "Assign copy"}</button>
        {source && <button type="button" onClick={() => review.review({ kind: "unassign", itemId })}>Unassign copy</button>}
        <button type="button" onClick={() => review.review({ kind: "removeOwned", itemId })}>Remove owned copy</button>
      </>}
    </fieldset>}
  </section>
}

export function InventoryAddOwned({ binding, onClose, onInspect }: { binding: InventoryOwnershipBinding; onClose: () => void; onInspect: (itemId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const [query, setQuery] = useState("")
  const [language, setLanguage] = useState<CardLanguage>("en")
  const [card, setCard] = useState<SearchCardResult | null>(null)
  const [finish, setFinish] = useState<CardFinish | undefined>()
  const offlineCards = useCallback(() => buildOfflineCardIndex([]), [])
  const search = useCardSearch(query, !card && binding.available, offlineCards, { language, includeNonPokemon: true })
  const review = useActionReview(binding, onClose)
  const finishes = card ? pickerFinishes(card) : []
  const selectedFinish = finish ?? (finishes.length === 1 ? finishes[0].finish : undefined)
  const candidate = card ? pickerCandidate(card) : undefined
  const resolve: InventoryCatalogResolver = id => candidate && card && matchesCatalogCardId(card, id) ? candidate : binding.catalog(id)
  const duplicates = card ? binding.snapshot.items.filter(i => i.identity.kind === "card" && matchesCatalogCardId(card, i.identity.cardId)) : []
  const ready = card && (finishes.length < 2 || finish !== undefined)
  return <div className={styles.overlay}>
    <div data-overlay-backdrop className={styles.backdrop} onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Add owned raw copy" className={styles.sheet} tabIndex={-1}>
      <header {...swipe} data-sheet-grabber className={styles.sheetHeader}><h2>Add owned card</h2><button type="button" aria-label="Close add owned card" onClick={onClose}><X size={20} /></button></header>
      <div className={styles.sheetBody}>
        {review.error && <p role="alert">{review.error}</p>}
        {review.draft ? <Confirmation review={review}><h3>Add a distinct raw copy as Unassigned?</h3><p>{card?.name} · {isCardLanguage(card?.language) ? card.language : "Language unknown"} · {selectedFinish ?? "Finish unknown"}</p><p>No storage slot changes. Existing raw and graded copies stay unchanged. This copy counts toward your current saved-card allowance.</p></Confirmation>
          : <fieldset disabled={!binding.available} className={styles.actions}>
            {!card ? <SlotCatalogSearch query={query} language={language} cards={search.cards} loading={search.loading} offline={search.offline} onQuery={setQuery} onLanguage={setLanguage} onSelect={selected => { setCard(selected); setFinish(undefined) }} /> : <>
              <button type="button" onClick={() => setCard(null)}>Back to cards</button>
              <h3>{card.name}</h3><p>{card.set.name} · {card.localId} · {isCardLanguage(card.language) ? card.language : "Language unknown"}</p>
              {finishes.length > 1 && <label className={styles.field}>Card finish<select value={finish ?? ""} onChange={e => setFinish(e.target.value as CardFinish || undefined)}><option value="">Choose finish</option>{finishes.map(f => <option key={f.finish} value={f.finish}>{f.label}</option>)}</select></label>}
              <p>{selectedFinish ?? "Finish unknown"} · Raw · Unassigned</p>
              {duplicates.length > 0 && <><p>You already own {duplicates.length} {duplicates.length === 1 ? "copy" : "copies"} of this printing. Adding another creates a separate raw copy.</p><div className={styles.actions}>{duplicates.map(i => <button type="button" key={i.id} onClick={() => onInspect(i.id)}>Inspect copy {i.id}</button>)}</div></>}
              <button type="button" disabled={!ready} onClick={() => review.review({ kind: "add", itemId: crypto.randomUUID(), identity: { kind: "card", cardId: card.canonicalId ?? card.id,
                ...(isCardLanguage(card.language) ? { language: card.language } : {}), ...(selectedFinish ? { finish: selectedFinish } : {}) } }, resolve)}>{duplicates.length ? "Add another raw copy" : "Add raw copy as Unassigned"}</button>
            </>}
          </fieldset>}
      </div>
    </div>
  </div>
}
