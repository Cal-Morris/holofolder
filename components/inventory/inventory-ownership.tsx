"use client"

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import SlotCatalogSearch from "@/components/binder/slot-catalog-search"
import { useCardSearch } from "@/hooks/use-card-search"
import { buildOfflineCardIndex } from "@/lib/offline-card-index"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { isCardLanguage, type CardFinish, type CardLanguage } from "@/lib/domain/cards"
import type { SlotTarget } from "@/lib/domain/binder-slots"
import type { InventorySnapshot, InventoryCatalogResolver } from "@/lib/domain/inventory"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import { pickerCandidate, pickerFinishes } from "@/lib/slot-picker"
import { inventoryActionDestinations, inventoryActionItemRef, inventoryOccupiedChoices, prepareInventoryAction, type InventoryAction, type InventoryOwnershipBinding } from "@/lib/inventory-actions"
import { prepareInventoryBulkAction, type InventoryBulkAction } from "@/lib/inventory-bulk-actions"
import styles from "./inventory.module.css"

const context = () => ({ source: "app" as const, clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() })

/** Immutable review survives local commit failure. Accepted intent belongs to the durable host. */
function useActionReview(binding: InventoryOwnershipBinding, onAccepted: () => void) {
  const [draft, setDraft] = useState<(ReturnType<typeof prepareInventoryAction> & { catalog: InventoryCatalogResolver }) | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const lock = useRef(false), alive = useRef(false)
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const review = (action: InventoryAction | InventoryBulkAction, catalog = binding.catalog) => {
    if (lock.current || !binding.available || draft) return
    try { setDraft({ ...(action.kind === "move" || "itemIds" in action ? prepareInventoryBulkAction(binding.snapshot, action, context(), catalog) : prepareInventoryAction(binding.snapshot, action, context(), catalog)), catalog }); setError("") }
    catch { setError(action.kind === "move" || "itemIds" in action ? "The entire selection could not be reviewed. Choose distinct raw copies and compatible empty slots within the command limits, or reduce the selection. Nothing was queued." : "This copy or destination is unavailable. Refresh current Inventory before trying again.") }
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

function targetLabel(target: SlotTarget | null): string {
  if (!target) return "Free slot"
  if (target.kind === "pokemon") return `Pokémon ${target.pokemonId} target`
  return `Printing ${target.cardId}${target.language ? ` · ${target.language}` : ""}${target.finish ? ` · ${target.finish}` : ""}`
}

function CopyPlacementReview({ draft }: { draft: ReturnType<typeof prepareInventoryAction> }) {
  const command = draft.intent.request.commands[0]
  if (command.kind !== "move" && command.kind !== "assign") return null
  const selectedId = command.kind === "move" ? command.item.itemId : command.selection.kind === "existing" ? command.selection.inventoryItemId : null
  const displacedId = command.destination.slot.inventoryItemId
  const location = (snapshot: InventorySnapshot, id: string) => {
    const p = snapshot.placements.find(p => p.inventoryItemId === id)
    return p ? `${snapshot.collections.find(c => c.id === p.collectionId)?.name ?? "Storage"}, slot ${p.slotId}` : "Unassigned"
  }
  const ids = [selectedId, displacedId].filter((id): id is string => id !== null)
  const slots = [command.kind === "move" ? command.item.placement : null, command.destination].filter(p => p !== null)
  return <>
    <h3>{command.occupied === "swap" ? "Swap these exact copies?" : displacedId ? "Move the occupied copy to Unassigned?" : "Place this exact copy?"}</h3>
    {ids.map(id => {
      const item = draft.before.items.find(i => i.id === id)!
      return <div key={id}>
        <p>Copy {id} · {item.identity.kind === "card" ? item.identity.cardId : `Pokémon ${item.identity.pokemonId}`} · {item.identity.kind === "card" ? item.identity.language ?? "Language unknown" : "Language unknown"} · {item.identity.kind === "card" ? item.identity.finish ?? "Finish unknown" : "Finish unknown"}</p>
        <p>{item.grading ? `${item.grading.provider.kind === "known" ? item.grading.provider.id : item.grading.provider.name} · ${item.grading.grade ?? "Grade unknown"}` : "Raw"}. From {location(draft.before, id)} to {location(draft.preview, id)}.</p>
      </div>
    })}
    <details><summary>Review slot targets and wants</summary>{slots.map(p => {
      const slot = draft.before.binders.find(b => b.collectionId === p.collectionId)!.slots.find(s => s.id === p.slot.id)!
      return <div key={slot.id}><p>Slot {slot.id}: {targetLabel(slot.target)}. {slot.wantedCards.length} explicit wants retained.</p>
        {slot.wantedCards.map((want, i) => <p key={i}>{want.card_name} · {want.card_id} · {want.card_language ?? "Language unknown"} · {want.card_finish ?? "Finish unknown"}</p>)}</div>
    })}</details>
    <p>Ownership stays unchanged. {command.kind === "move" && command.occupied !== "swap" ? "The former slot becomes unfilled. " : ""}Targets, wants, provenance and slot order stay unchanged. No want is fulfilled. {displacedId ? "Both copies retain their" : "The copy retains its"} identity, grading, certificate, acquisition and source metadata.</p>
    <p>After sync and a fresh complete read, use Find acknowledged change to locate the exact Activity event. Recovery requires a supported preview and current permission and version checks; newer edits may prevent it.</p>
  </>
}

export function InventoryCopyActions({ binding, itemId, onAccepted }: { binding: InventoryOwnershipBinding; itemId: string; onAccepted: () => void }) {
  const [placing, setPlacing] = useState(false)
  const [destination, setDestination] = useState("")
  const [occupied, setOccupied] = useState<"" | "unassign" | "swap">("")
  const review = useActionReview(binding, onAccepted)
  const item = binding.snapshot.items.find(i => i.id === itemId)
  if (!item) return null
  const ref = inventoryActionItemRef(binding.snapshot, itemId)
  const destinations = inventoryActionDestinations(binding.snapshot, itemId, binding.catalog)
  const selectedDestination = destinations.find(d => d.slot.id === destination)
  const choices = selectedDestination ? inventoryOccupiedChoices(binding.snapshot, itemId, selectedDestination, binding.catalog) : []
  const command = review.draft?.intent.request.commands[0]
  const source = ref.placement
  const location = source ? `${binding.snapshot.collections.find(c => c.id === source.collectionId)?.name ?? "Storage"}, slot ${source.slot.id}` : "Unassigned"
  return <section aria-label={item.grading ? "Graded copy placement" : "Raw copy ownership"} className={styles.ownership}>
    {review.error && <p role="alert">{review.error}</p>}
    {command ? <Confirmation review={review} details={command.kind === "removeOwned" ? <p>After sync, open Activity to review recovery of this exact copy and its saved metadata. Recovery checks current versions; if the former slot is occupied, explicitly choose Unassigned. Recovery may be unavailable if history or current permissions cannot be verified.</p> : undefined}>
      {(command.kind === "assign" || command.kind === "move") && review.draft ? <CopyPlacementReview draft={review.draft} /> : <>
      <h3>{command.kind === "removeOwned" ? "Remove this owned copy?" : command.kind === "unassign" ? "Keep this copy Unassigned?" : "Place this exact copy?"}</h3>
      <p>Copy {itemId} · {location}</p>
      {command.kind === "removeOwned" ? <p>Ownership decreases by one. {source ? "Its placement is cleared. The former slot, target, wants and order remain." : "No storage slot changes."} Other copies stay unchanged.</p>
        : <p>Ownership stays unchanged. The former slot becomes unfilled; its target, wants and order remain. Identity, grading, certificate, private label assets, acquisition and source metadata stay unchanged.</p>}
      </>}
    </Confirmation> : <fieldset disabled={!binding.available} className={styles.actions}>
      {placing ? <>
        <label className={styles.field}>Compatible slot<select aria-label="Compatible slot" value={destination} onChange={e => { setDestination(e.target.value); setOccupied("") }}>
          <option value="">Choose a destination</option>{destinations.map(d => <option key={d.slot.id} value={d.slot.id}>{binding.snapshot.collections.find(c => c.id === d.collectionId)?.name} · Slot {d.slot.id}{d.slot.inventoryItemId ? " · Occupied" : " · Empty"}</option>)}
        </select></label>
        {!destinations.length && <p>No compatible slots are available. Unknown printing or missing metadata cannot satisfy constrained targets.</p>}
        {selectedDestination?.slot.inventoryItemId && <>
          <p>Occupied by copy {selectedDestination.slot.inventoryItemId}. Choose what happens to it before reviewing.</p>
          <label className={styles.field}>Occupied destination decision<select aria-label="Occupied destination decision" value={occupied} onChange={e => setOccupied(e.target.value as typeof occupied)}>
            <option value="">Choose explicitly</option>
            {choices.includes("unassign") && <option value="unassign">Move occupied copy to Unassigned</option>}
            {choices.includes("swap") && <option value="swap">Swap copies</option>}
          </select></label>
          {!choices.includes("swap") && <p>Swap unavailable: this copy needs a source slot, and both copies must match their resulting targets.</p>}
          {!choices.length && <p>This destination cannot be safely reviewed. Cancel and refresh current Inventory.</p>}
        </>}
        <button type="button" disabled={!selectedDestination || (selectedDestination.slot.inventoryItemId !== null && (!occupied || !choices.includes(occupied)))} onClick={() => {
          const d = selectedDestination
          if (d) review.review({ kind: "place", itemId, collectionId: d.collectionId, slotId: d.slot.id, ...(occupied ? { occupied } : {}) })
        }}>Review placement</button>
        <button type="button" onClick={() => setPlacing(false)}>Cancel placement</button>
      </> : <>
        <button type="button" onClick={() => setPlacing(true)}>{source ? "Move copy" : "Assign copy"}</button>
        {source && <button type="button" onClick={() => review.review({ kind: "unassign", itemId })}>Unassign copy</button>}
        {item.grading === null ? <button type="button" onClick={() => review.review({ kind: "removeOwned", itemId })}>Remove owned copy</button> : <p>Graded removal is unavailable because recovery cannot verify private label assets. Assign, move and unassign retain every grading and private field.</p>}
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


export function InventoryBulkReview({ binding, itemIds, onClose, onAccepted }: { binding: InventoryOwnershipBinding; itemIds: readonly string[]; onClose: () => void; onAccepted: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const review = useActionReview(binding, onAccepted)
  const location = (snapshot: InventorySnapshot, id: string) => {
    const p = snapshot.placements.find(p => p.inventoryItemId === id)
    return p ? `${snapshot.collections.find(c => c.id === p.collectionId)?.name ?? "Storage"}, slot ${p.slotId}` : "Unassigned"
  }
  return <div className={styles.overlay}>
    <div data-overlay-backdrop className={styles.backdrop} onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Review selected raw copies" className={styles.sheet} tabIndex={-1}>
      <header {...swipe} data-sheet-grabber className={styles.sheetHeader}><h2>{itemIds.length} selected raw copies</h2><button type="button" aria-label="Close bulk review" onClick={onClose}><X size={20} /></button></header>
      <div className={styles.sheetBody}>
        {review.error && <p role="alert">{review.error}</p>}
        {review.draft ? <Confirmation review={review}>
          <h3>Apply this entire ordered mapping?</h3>
          <ol>{itemIds.map(id => {
            const item = review.draft!.before.items.find(i => i.id === id)!
            return <li key={id}><p>Copy {id} · {item.identity.kind === "card" ? item.identity.cardId : `Pokémon ${item.identity.pokemonId}`} · {item.identity.kind === "card" ? item.identity.language ?? "Language unknown" : "Language unknown"} · {item.identity.kind === "card" ? item.identity.finish ?? "Finish unknown" : "Finish unknown"} · Raw</p><p>From {location(review.draft!.before, id)} to {location(review.draft!.preview, id)}</p></li>
          })}</ol>
          <details><summary>Review retained slot targets and wants</summary>{[...new Set(review.draft.intent.request.commands.flatMap(c => ["item" in c ? c.item.placement?.slot.id : null, "destination" in c ? c.destination.slot.id : null]).filter((id): id is string => !!id))].map(id => {
            const slot = review.draft!.before.binders.flatMap(b => b.slots).find(s => s.id === id)!
            return <div key={id}><p>Slot {id}: {targetLabel(slot.target)}. {slot.wantedCards.length} explicit wants retained.</p>{slot.wantedCards.map((want, i) => <p key={i}>{want.card_name} · {want.card_id} · {want.card_language ?? "Language unknown"} · {want.card_finish ?? "Finish unknown"}</p>)}</div>
          })}</details>
          <p>One atomic request for all {itemIds.length} copies. Ownership, identity, grading, acquisition and source metadata stay unchanged. Former slots become unfilled; targets, explicit wants, provenance and order remain. No want is fulfilled.</p>
          <p>After sync and a fresh complete read, use Find acknowledged change for this exact Activity event. Recovery needs a supported preview and current permission and version checks. There is no instant Undo.</p>
        </Confirmation> : <fieldset disabled={!binding.available} className={styles.actions}>
          <p>Only these explicitly selected copies are included, in selection order. Choose a different empty saved slot for every copy to move, or unassign all placed copies. Graded bulk actions are unavailable; place graded copies individually.</p>
          {itemIds.map((id, index) => <label key={id} className={styles.field}>{index + 1}. Copy {id} · {location(binding.snapshot, id)}
            <select aria-label={`Empty destination for ${id}`} value={mapping[id] ?? ""} onChange={e => setMapping(m => ({ ...m, [id]: e.target.value }))}>
              <option value="">Choose an empty destination</option>
              {inventoryActionDestinations(binding.snapshot, id, binding.catalog).filter(d => d.slot.inventoryItemId === null).map(d => {
                const key = JSON.stringify([d.collectionId, d.slot.id])
                return <option key={key} value={key} disabled={itemIds.some(other => other !== id && mapping[other] === key)}>{binding.snapshot.collections.find(c => c.id === d.collectionId)?.name} · Slot {d.slot.id} · Empty</option>
              })}
            </select>
          </label>)}
          <button type="button" disabled={!itemIds.every(id => mapping[id])} onClick={() => review.review({ kind: "move", mapping: itemIds.map(itemId => {
            const [collectionId, slotId] = JSON.parse(mapping[itemId]) as [string, string]
            return { itemId, collectionId, slotId }
          }) })}>Review bulk Move</button>
          <button type="button" disabled={!itemIds.every(id => binding.snapshot.placements.some(p => p.inventoryItemId === id))} onClick={() => review.review({ kind: "unassign", itemIds })}>Review bulk Unassign</button>
          {!itemIds.every(id => binding.snapshot.placements.some(p => p.inventoryItemId === id)) && <p>Unassign requires every selected copy to be placed. Clear the selection and choose placed raw copies.</p>}
        </fieldset>}
      </div>
    </div>
  </div>
}
