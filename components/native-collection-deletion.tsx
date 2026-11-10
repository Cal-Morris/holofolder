"use client"

import { useRef, useState } from 'react'
import type { CollectionNavigationRead } from '@/lib/collection-navigation'
import { collectionDeletionEvidence, prepareCollectionDeletion, type CollectionDeletionDraft } from '@/lib/native-collection-deletion'
import type { SlotLocalAcceptance } from '@/lib/binder-slot-editing'
import { useSlotDraftAcceptance } from '@/hooks/use-slot-draft-acceptance'
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay'

export interface CollectionDeletionBinding {
  read: CollectionNavigationRead
  available: boolean
  receive: (draft: CollectionDeletionDraft) => Promise<SlotLocalAcceptance>
}
const button = 'min-h-10 rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50'

export default function NativeCollectionDeletion({ binding, collectionId, onClose }: {
  binding: CollectionDeletionBinding; collectionId: string; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const [replacement, setReplacement] = useState('')
  const [review, setReview] = useState<CollectionDeletionDraft | null>(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [acknowledged, setAcknowledged] = useState(false)
  const { pending, busy, message, handoff } = useSlotDraftAcceptance(async draft => {
    if (!binding.available) throw new Error('fresh-scoped-read-required')
    return binding.receive(draft as CollectionDeletionDraft)
  }, onClose)
  const snapshot = binding.read.evidence.kind === 'unavailable' ? null : binding.read.evidence.snapshot
  const collection = snapshot?.collections.find(c => c.id === collectionId)
  const needsReplacement = binding.read.defaultCollectionId === collectionId
  let boundary = '', stale = false
  try { const evidence = collectionDeletionEvidence(binding.read); stale = !!review && evidence !== review.evidence }
  catch (e) { boundary = e instanceof Error ? e.message : 'Current native storage is unavailable.' }
  const blocked = !binding.available || !!boundary || stale || busy
  const rows = review?.rows.slice(page * 40, (page + 1) * 40) ?? []
  return <div className="fixed inset-0 z-40">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/60" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Delete collection" tabIndex={-1}
      className="absolute inset-x-3 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-xl [overflow-wrap:anywhere]">
      <header data-sheet-grabber {...swipe} className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <h2 className="min-w-0 text-sm font-semibold">Delete collection</h2>
        <button type="button" aria-label="Close collection deletion" className="h-10 w-10 shrink-0" onClick={onClose}>✕</button>
      </header>
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-3 text-sm">
        <p>Collection to delete: {review?.collection.name ?? collection?.name ?? 'Unavailable'} · {collectionId}</p>
        {!review && <>
          <p>Delete this collection and all its slots, targets and explicit wants. Every assigned owned copy stays in Inventory as Unassigned, with its identity, grading and source metadata.</p>
          {needsReplacement && <label className="block">Replacement default collection
            <select aria-label="Replacement default collection" className="mt-1 min-h-10 w-full min-w-0 rounded-xl border border-border bg-background px-2 text-sm" value={replacement} onChange={e => setReplacement(e.target.value)}>
              <option value="">Choose a replacement</option>
              {snapshot?.collections.filter(c => c.id !== collectionId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>}
        </>}
        {review && <>
          <p role="status">Slots to delete: {review.counts.slots} · Targets to delete: {review.counts.targets} · Explicit wants to delete: {review.counts.wants} · Owned copies retained Unassigned: {review.counts.unassigned}</p>
          {review.replacement && <p>New default: {review.replacement.name} · {review.replacement.id}</p>}
          <p>Sharing links for this collection stop working. Recovery can be unavailable or blocked by newer edits. After sync, inspect Activity and use Review recovery only when supported. No instant Undo or restored public link is promised.</p>
          <label className="flex min-h-10 items-center gap-2"><input type="checkbox" className="h-5 w-5 shrink-0" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} />I confirm deletion of this collection, its targets and wants, retaining owned copies as Unassigned</label>
          <p>Confirmation saves one atomic intent on this device, pending sync. Closing cannot cancel accepted work.</p>
        </>}
        {(boundary || error || message) && <p role="alert">{boundary || error || message}</p>}
        {(stale || !binding.available) && <p role="alert">Current storage or session changed or has unresolved work. This review is blocked. Close and review current storage.</p>}
        {busy && <p role="status">Saving on device…</p>}
        {rows.map(({ slot, item, position }) => <section key={slot.id} aria-label={`Delete saved slot ${position}`} className="space-y-1 rounded-xl border border-border p-3">
          <p>Slot {position} · {slot.id}</p>
          <p>{slot.target ? `Target to delete: ${slot.target.kind === 'pokemon' ? `Pokémon #${slot.target.pokemonId}` : `${slot.target.cardId} · ${slot.target.language ?? 'Any language'} · ${slot.target.finish ?? 'Any finish'}`}` : 'No target'}</p>
          {slot.wantedCards.length ? <ul>{slot.wantedCards.map((want, i) => <li key={i}>Want to delete: {want.card_name} · {want.card_id} · {want.card_language ?? 'Any language'} · {want.card_finish ?? 'Any finish'}</li>)}</ul> : <p>No explicit wants</p>}
          <p>{item ? `Retain copy ${item.id} as Unassigned · ${item.identity.kind === 'card' ? item.identity.cardId : `Pokémon #${item.identity.pokemonId}, unknown printing`} · ${item.grading ? 'Recorded graded copy, metadata retained' : 'Raw or unknown grade, metadata retained'}` : 'No assigned owned copy'}</p>
        </section>)}
        {review && review.rows.length > 40 && <nav aria-label="Deletion preview pages" className="flex flex-wrap items-center gap-2">
          <button className={button} disabled={!page} onClick={() => setPage(p => p - 1)}>Previous preview page</button>
          <p>Slots {page * 40 + 1} to {Math.min((page + 1) * 40, review.rows.length)} of {review.rows.length}</p>
          <button className={button} disabled={(page + 1) * 40 >= review.rows.length} onClick={() => setPage(p => p + 1)}>Next preview page</button>
        </nav>}
      </div>
      <footer className="flex shrink-0 flex-wrap gap-2 border-t border-border p-3">
        {!review ? <button className={button} disabled={blocked || needsReplacement && !replacement} onClick={() => {
          try { setReview(prepareCollectionDeletion(binding.read, collectionId, needsReplacement ? replacement : null, {
            source: 'app', clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString(),
          })); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Unsupported collection deletion. Nothing was handed off.') }
        }}>Review collection deletion</button> : <button className={button} disabled={blocked || !acknowledged} onClick={() => handoff(pending ?? review)}>{pending ? 'Retry same collection deletion' : 'Confirm collection deletion'}</button>}
        <button className={button} onClick={onClose}>Cancel deletion</button>
      </footer>
    </div>
  </div>
}
