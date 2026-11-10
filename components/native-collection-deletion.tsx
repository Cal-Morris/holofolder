"use client"

import { useRef, useState } from 'react'
import type { CollectionNavigationRead } from '@/lib/collection-navigation'
import { collectionDeletionEvidence, prepareCollectionDeletion, type CollectionDeletionDraft } from '@/lib/native-collection-deletion'
import type { SlotLocalAcceptance } from '@/lib/binder-slot-editing'
import { useSlotDraftAcceptance } from '@/hooks/use-slot-draft-acceptance'
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay'
import { browserHostDisplayCatalog } from '@/lib/collection/browser-host-catalog'
import { describeIdentity } from '@/lib/pocket-labels'

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
  const name = review?.collection.name ?? collection?.name ?? 'this binder'
  const namer = browserHostDisplayCatalog(binding.read.catalog)
  const kept = review?.rows.flatMap(row => row.item ? [describeIdentity(row.item.identity, namer)] : []) ?? []
  const shownKept = kept.slice(page * 12, (page + 1) * 12)
  const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
  return <div className="fixed inset-0 z-[42]">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/60" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Delete collection" tabIndex={-1}
      className="absolute inset-x-3 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-xl [overflow-wrap:anywhere]">
      <header data-sheet-grabber {...swipe} className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <h2 className="min-w-0 text-sm font-semibold">Delete {name}?</h2>
        <button type="button" aria-label="Close collection deletion" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-muted" onClick={onClose}>✕</button>
      </header>
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-3 text-sm">
        {!review && <>
          <p>Deleting a binder removes its pockets and anything wanted in them. <span className="font-semibold">Your cards are kept.</span> They stay in your collection, out of a binder, until you place them again.</p>
          {needsReplacement && <label className="block">This is the binder that opens first. Choose which one should open first instead
            <select aria-label="Replacement default collection" className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-border bg-background px-2 text-base md:text-sm" value={replacement} onChange={e => setReplacement(e.target.value)}>
              <option value="">Choose a binder</option>
              {snapshot?.collections.filter(c => c.id !== collectionId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>}
        </>}
        {review && <>
          <ul role="status" aria-label="What happens" className="space-y-1.5">
            <li>{plural(review.counts.slots, 'pocket')} {review.counts.slots === 1 ? 'is' : 'are'} removed.</li>
            {review.counts.wants > 0 && <li>{plural(review.counts.wants, 'wanted card')} {review.counts.wants === 1 ? 'leaves' : 'leave'} your want list.</li>}
            <li><span className="font-semibold">{review.counts.unassigned ? `${plural(review.counts.unassigned, 'card')} ${review.counts.unassigned === 1 ? 'stays' : 'stay'} in your collection` : 'No cards are removed from your collection'}</span>{review.counts.unassigned ? ', out of a binder.' : '.'}</li>
            {review.replacement && <li>{review.replacement.name} becomes the binder that opens first.</li>}
            <li>Any shared link to this binder stops working.</li>
          </ul>
          {kept.length > 0 && <details className="rounded-xl border border-border/60 px-3">
            <summary className="min-h-11 cursor-pointer py-3 font-medium">Cards that stay in your collection</summary>
            <ul className="space-y-1 pb-3 text-xs">{shownKept.map((card, index) => <li key={index}><span className="font-semibold">{card.name}</span> <span className="text-muted-foreground">{card.detail}</span></li>)}</ul>
            {kept.length > 12 && <nav aria-label="Deletion preview pages" className="flex items-center justify-between gap-2 pb-3 text-xs">
              <button className={button} disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button>
              <span>{page * 12 + 1} to {Math.min((page + 1) * 12, kept.length)} of {kept.length}</span>
              <button className={button} disabled={(page + 1) * 12 >= kept.length} onClick={() => setPage(p => p + 1)}>Next</button>
            </nav>}
          </details>}
          <p className="text-muted-foreground">This can&apos;t be undone with one tap.</p>
          <label className="flex min-h-11 items-center gap-2 font-medium"><input type="checkbox" className="h-5 w-5 shrink-0" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} />I understand, delete this binder</label>
        </>}
        {(boundary || error) && <p role="alert">This binder can&apos;t be deleted right now. Check your connection, let your latest changes finish saving and try again.</p>}
        {message && <p role="alert">{message}</p>}
        {!boundary && (stale || !binding.available) && <p role="alert">{stale ? 'Your collection changed while this was open. Close this and try again.' : 'Your latest changes are still saving. Try again in a moment.'}</p>}
      </div>
      <footer className="flex shrink-0 flex-wrap gap-2 border-t border-border p-3">
        <button className="min-h-11 rounded-2xl border border-border/70 px-4 text-sm font-medium" onClick={onClose}>Keep it</button>
        {!review ? <button className="min-h-11 flex-1 rounded-2xl border border-destructive/50 px-3 text-sm font-semibold text-destructive disabled:opacity-45" disabled={blocked || needsReplacement && !replacement} onClick={() => {
          try { setReview(prepareCollectionDeletion(binding.read, collectionId, needsReplacement ? replacement : null, {
            source: 'app', clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString(),
          })); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'unsupported') }
        }}>Continue</button> : <button className="min-h-11 flex-1 rounded-2xl bg-destructive px-3 text-sm font-semibold text-white disabled:opacity-45" disabled={blocked || !acknowledged} onClick={() => handoff(pending ?? review)}>{busy ? 'Deleting…' : pending ? 'Try again' : 'Delete binder'}</button>}
      </footer>
    </div>
  </div>
}
