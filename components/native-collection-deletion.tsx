"use client"

import { useMemo, useRef, useState } from 'react'
import type { CollectionNavigationRead } from '@/lib/collection-navigation'
import { prepareCollectionDeletion, type CollectionDeletionDraft } from '@/lib/native-collection-deletion'
import type { SlotLocalAcceptance } from '@/lib/binder-slot-editing'
import { useSlotDraftAcceptance } from '@/hooks/use-slot-draft-acceptance'
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay'
import { browserHostDisplayCatalog } from '@/lib/collection/browser-host-catalog'
import { describeIdentity } from '@/lib/pocket-labels'
import { Select } from "@/components/ui/select"

export interface CollectionDeletionBinding {
  read: CollectionNavigationRead
  available: boolean
  receive: (draft: CollectionDeletionDraft) => Promise<SlotLocalAcceptance>
}
const PAGE = 12
const pageButton = 'min-h-10 rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50'
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

export default function NativeCollectionDeletion({ binding, collectionId, onClose }: {
  binding: CollectionDeletionBinding; collectionId: string; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const snapshot = binding.read.evidence.kind === 'unavailable' ? null : binding.read.evidence.snapshot
  const others = snapshot?.collections.filter(c => c.id !== collectionId) ?? []
  const needsReplacement = binding.read.defaultCollectionId === collectionId
  const [replacement, setReplacement] = useState(() => needsReplacement ? others[0]?.id ?? '' : '')
  const [removeOwned, setRemoveOwned] = useState(false)
  const [page, setPage] = useState(0)
  const { pending, busy, message, handoff } = useSlotDraftAcceptance<CollectionDeletionDraft>(async draft => {
    if (!binding.available) throw new Error('fresh-scoped-read-required')
    return binding.receive(draft as CollectionDeletionDraft)
  }, onClose)
  // Re-planned from the current complete read, so the summary always matches what is sent.
  // A handed-off draft is retried as-is.
  const prepared = useMemo(() => {
    try {
      return { draft: prepareCollectionDeletion(binding.read, collectionId, needsReplacement ? replacement : null, {
        source: 'app', clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString(),
      }, removeOwned) }
    } catch { return { draft: null } }
  }, [binding.read, collectionId, needsReplacement, replacement, removeOwned])
  const draft = pending ?? prepared.draft
  const locked = busy || !!pending
  const name = draft?.collection.name ?? snapshot?.collections.find(c => c.id === collectionId)?.name ?? 'this binder'
  const namer = browserHostDisplayCatalog(binding.read.catalog)
  const cards = draft?.rows.flatMap(row => row.item ? [{ ...describeIdentity(row.item.identity, namer), graded: row.item.grading !== null }] : []) ?? []
  const shown = cards.slice(page * PAGE, (page + 1) * PAGE)
  const counts = draft?.counts

  return <div className="fixed inset-0 z-[42]">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/60" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Delete collection" tabIndex={-1}
      className="absolute inset-x-3 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-xl [overflow-wrap:anywhere]">
      <header data-sheet-grabber {...swipe} className="relative flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/30" />
        <h2 className="min-w-0 text-sm font-semibold">Delete {name}?</h2>
        <button type="button" aria-label="Close collection deletion" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-muted" onClick={onClose}>✕</button>
      </header>
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-3 text-sm">
        {counts && <p role="status">
          Removes its {plural(counts.slots, 'pocket')}{counts.wants > 0 && <> and {plural(counts.wants, 'wanted card')}</>}. Any shared link to it stops working.
        </p>}
        {needsReplacement && <label className="block">
          <span className="text-muted-foreground">Open this binder first instead</span>
          <Select aria-label="Replacement default collection" className="mt-1 w-full" value={replacement} disabled={locked} onChange={e => setReplacement(e.target.value)}>
            {others.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </label>}
        {counts && counts.cards > 0 && <div className="rounded-xl border border-border/60">
          <label className="flex min-h-11 items-start gap-3 p-3">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-destructive" checked={removeOwned} disabled={locked} onChange={e => { setRemoveOwned(e.target.checked); setPage(0) }} />
            <span className="space-y-0.5">
              <span className="block font-medium">Also remove {counts.cards === 1 ? 'its card' : `its ${counts.cards} cards`} from my collection</span>
              <span className="block text-xs text-muted-foreground">
                {!removeOwned ? `Otherwise ${counts.cards === 1 ? 'it stays' : 'they stay'} in your collection, out of a binder.`
                  : counts.graded > 0 ? `${plural(counts.graded, 'graded card')} ${counts.graded === 1 ? 'stays' : 'stay'} in your collection, out of a binder.`
                  : `${counts.cards === 1 ? 'It is' : 'They are'} removed along with the binder.`}
              </span>
            </span>
          </label>
          <details className="border-t border-border/60 px-3">
            <summary className="min-h-11 cursor-pointer py-3 font-medium">Cards in this binder ({cards.length})</summary>
            <ul className="space-y-1 pb-3 text-xs">{shown.map((card, index) => <li key={index}>
              <span className="font-semibold">{card.name}</span> <span className="text-muted-foreground">{card.detail}{card.graded && ' · Graded'}</span>
            </li>)}</ul>
            {cards.length > PAGE && <nav aria-label="Deletion preview pages" className="flex items-center justify-between gap-2 pb-3 text-xs">
              <button type="button" className={pageButton} disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button>
              <span>{page * PAGE + 1} to {Math.min((page + 1) * PAGE, cards.length)} of {cards.length}</span>
              <button type="button" className={pageButton} disabled={(page + 1) * PAGE >= cards.length} onClick={() => setPage(p => p + 1)}>Next</button>
            </nav>}
          </details>
        </div>}
        {!draft && <p role="alert">This binder can&apos;t be deleted right now. Check your connection, let your latest changes finish saving and try again.</p>}
        {draft && !binding.available && <p role="alert">Your latest changes are still saving. Try again in a moment.</p>}
        {message && <p role="alert">{message}</p>}
      </div>
      <footer className="flex shrink-0 gap-2 border-t border-border p-3">
        <button type="button" className="min-h-11 flex-1 rounded-2xl border border-border/70 px-3 text-sm font-medium" onClick={onClose}>Keep it</button>
        <button type="button" className="min-h-11 flex-1 rounded-2xl bg-destructive px-3 text-sm font-semibold text-white disabled:opacity-45"
          disabled={!draft || !binding.available || busy} onClick={() => draft && handoff(draft)}>
          {busy ? 'Deleting…' : pending ? 'Try again' : counts?.removed ? 'Delete all' : 'Delete binder'}
        </button>
      </footer>
    </div>
  </div>
}
