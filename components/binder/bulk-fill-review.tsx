'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import CardImage from '@/components/card-image';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { useSlotDraftAcceptance } from '@/hooks/use-slot-draft-acceptance';
import type { LayoutBoundary } from '@/components/binder/layout-editor';
import type { BulkSelection } from '@/lib/binder-bulk-editing';
import {
  automaticBulkFillChoices,
  isFillSpacer,
  previewBulkFill,
  prepareBulkFillIntent,
  type BulkFillChoices,
} from '@/lib/binder-bulk-fill';
import { sameValue } from '@/lib/collection/slot-optimistic';
import { describeIdentity, formatGradeLabel, pocketPlace } from '@/lib/pocket-labels';
import { slotDraftFailureMessage } from '@/lib/slot-draft-failure';
import { Select } from '@/components/ui/select';

/** Why a chosen spare card can't go in a pocket, in the person's terms. */
function fillProblem(reason: string | null) {
  if (!reason) return null;
  if (reason.startsWith('Copy selected more than once')) return 'This card is already chosen for another pocket.';
  if (reason.startsWith('Target mismatch')) return "This card doesn't match what the pocket is for.";
  if (reason.startsWith('Unresolved catalog identity'))
    return "This card can't be checked against the pocket right now.";
  if (reason.startsWith('Copy already assigned') || reason.startsWith('Copy unavailable'))
    return 'This card is no longer spare.';
  return null;
}

/**
 * Fill selected empty pockets from spare cards (owned, not in any pocket). Nothing new is added to the collection
 * and pockets that already hold a card are left alone. Each pocket is filled only with the card chosen for it.
 */
export default function BulkFillReview({
  boundary,
  selection,
  grid,
  onClose,
}: {
  boundary: LayoutBoundary;
  selection: BulkSelection;
  grid?: { rows: number; cols: number };
  onClose: () => void;
}) {
  const [original] = useState(() => structuredClone(boundary.snapshot));
  const binder = original.binders.find((b) => b.collectionId === boundary.scope.collectionId)!;
  const [choices, setChoices] = useState<BulkFillChoices>({});
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(true, onClose, { containerRef: ref });
  const swipe = useSwipeToDismiss(ref, onClose);
  const stale = !sameValue(original, boundary.snapshot);
  // A pocket with no card chosen is simply left as it is.
  const settled: BulkFillChoices = Object.fromEntries(
    selection.slots.map(({ slot }) => [slot.id, choices[slot.id] ?? null]),
  );
  const preview = previewBulkFill(original, boundary.scope, selection, settled, boundary.catalog);
  const { pending, busy, message, handoff } = useSlotDraftAcceptance(async (draft) => {
    const receipt = await boundary.bulkFill?.receive(draft);
    if (!receipt) throw new Error('durable-acceptance-required');
    return receipt;
  }, onClose);
  useEffect(() => {
    if (!boundary.bulkFill?.available) onClose();
    window.addEventListener('offline', onClose);
    return () => window.removeEventListener('offline', onClose);
  }, [boundary.bulkFill?.available, onClose]);
  const spare = original.items.filter((item) => !original.placements.some((p) => p.inventoryItemId === item.id));
  const label = (itemId: string) => {
    const item = original.items.find((i) => i.id === itemId);
    if (!item) return null;
    const card = describeIdentity(item.identity, boundary.resolveCard);
    return {
      ...card,
      detail: [card.detail, item.grading ? formatGradeLabel(item.grading) : null].filter(Boolean).join(' · '),
    };
  };
  const fillable = selection.slots.filter(({ slot }) => !slot.inventoryItemId && !isFillSpacer(binder, slot));
  const untouched = selection.slots.length - fillable.length;
  const adding = preview.rows.filter((row) => !row.skipped && !row.reason).length;
  const locked = busy || Boolean(pending) || stale;
  const confirm = () => {
    if (locked || !preview.ready || !boundary.bulkFill?.available) return;
    try {
      handoff(
        prepareBulkFillIntent(
          original,
          boundary.scope,
          selection,
          settled,
          {
            source: 'app',
            clientId: null,
            operationId: crypto.randomUUID(),
            batchId: null,
            clientOccurredAt: new Date().toISOString(),
          },
          boundary.catalog,
        ),
      );
    } catch (cause) {
      setError(slotDraftFailureMessage(cause));
    }
  };
  return (
    <div className="fixed inset-0 z-40">
      <div data-overlay-backdrop aria-hidden="true" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Fill pockets"
        className="border-border bg-card text-foreground absolute inset-x-3 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border shadow-xl"
      >
        <header
          data-sheet-grabber
          {...swipe}
          className="border-border relative flex shrink-0 items-center justify-between gap-2 border-b p-3"
        >
          <span
            aria-hidden="true"
            className="bg-muted-foreground/30 pointer-events-none absolute top-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
          />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Fill pockets from spare cards</h2>
            <p className="text-muted-foreground text-xs">
              Spare cards are ones you own that aren&apos;t in a pocket yet.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="hover:bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain p-3 text-sm [overflow-wrap:anywhere]">
          {!spare.length ? (
            <p className="text-muted-foreground py-4 text-center">
              You have no spare cards. Every card you own is already in a pocket.
            </p>
          ) : (
            <>
              <button
                type="button"
                className="border-border min-h-10 w-full rounded-xl border px-3 text-sm font-medium disabled:opacity-50"
                disabled={locked}
                onClick={() => {
                  setChoices(automaticBulkFillChoices(original, boundary.scope, selection, boundary.catalog));
                  setError(null);
                }}
              >
                Match my spare cards
              </button>
              {fillable.map(({ slot }) => {
                const row = preview.rows.find((r) => r.slotId === slot.id)!;
                const chosen = choices[slot.id] ? label(choices[slot.id]!) : null;
                const wants = slot.target ? describeIdentity(slot.target, boundary.resolveCard) : null;
                const problem = choices[slot.id] ? fillProblem(row.reason) : null;
                const place = grid ? pocketPlace(row.position - 1, grid.rows, grid.cols) : `Pocket ${row.position}`;
                return (
                  <section
                    key={slot.id}
                    aria-label={place}
                    className="border-border/60 flex items-center gap-3 rounded-xl border p-2"
                  >
                    <span className="trading-card bg-muted relative w-10 shrink-0 overflow-hidden rounded">
                      {chosen?.image && (
                        <CardImage src={chosen.image} alt="" fill sizes="40px" className="object-cover" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-muted-foreground truncate text-xs">
                        {place}
                        {wants ? ` · for ${wants.name}` : ' · any card'}
                      </p>
                      <Select
                        aria-label={`Card for ${place}`}
                        className="w-full"
                        disabled={locked}
                        value={choices[slot.id] ?? ''}
                        onChange={(event) =>
                          setChoices((current) => ({ ...current, [slot.id]: event.target.value || null }))
                        }
                      >
                        <option value="">Leave empty</option>
                        {spare.map((item) => {
                          const card = label(item.id)!;
                          return (
                            <option key={item.id} value={item.id}>
                              {card.name} · {card.detail}
                            </option>
                          );
                        })}
                      </Select>
                      {problem && (
                        <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
                          {problem}
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
              {!fillable.length && (
                <p className="text-muted-foreground py-2 text-center">Every selected pocket already has a card.</p>
              )}
              {untouched > 0 && fillable.length > 0 && (
                <p className="text-muted-foreground text-xs">
                  {untouched} selected pocket{untouched === 1 ? '' : 's'} already{' '}
                  {untouched === 1 ? 'has a card and stays' : 'have cards and stay'} as{' '}
                  {untouched === 1 ? 'it is' : 'they are'}.
                </p>
              )}
            </>
          )}
          {message && <p role="alert">{message}</p>}
          {(stale || error) && (
            <p role="alert">
              {stale ? 'Your binder changed while this was open. Close this and select the pockets again.' : error}
            </p>
          )}
        </div>
        <footer className="border-border flex shrink-0 gap-2 border-t p-3">
          <button
            type="button"
            className="border-border min-h-11 flex-1 rounded-xl border px-3 text-sm font-medium"
            onClick={onClose}
          >
            Cancel
          </button>
          {pending ? (
            <button
              type="button"
              className="bg-primary text-primary-foreground min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold disabled:opacity-50"
              disabled={busy}
              onClick={() => handoff(pending)}
            >
              Try again
            </button>
          ) : (
            <button
              type="button"
              className="bg-primary text-primary-foreground min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold disabled:opacity-50"
              disabled={locked || !preview.ready}
              onClick={confirm}
            >
              {busy ? 'Adding…' : adding ? `Add ${adding} card${adding === 1 ? '' : 's'}` : 'Choose a card'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
