'use client';

import { useRef, useState } from 'react';
import { ArrowLeftRight, MapPin, MoreHorizontal, Trash2, X } from 'lucide-react';
import CardImage from '@/components/card-image';
import CardImageZoom from '@/components/card-image-zoom';
import NativeCardPrice from '@/components/binder/native-card-price';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import type { InventoryBrowseRow, InventoryLocationIntent } from '@/lib/domain/inventory-browse';
import { inventoryLocationLabel } from '@/lib/inventory-location';
import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import { isCardFinish, isCardLanguage } from '@/lib/domain/cards';
import type { PricingRegion } from '@/lib/pricing-region';
import { InventoryMove, useInventorySave, type InventoryLabels } from './inventory-ownership';
import type { InventoryOwnershipBinding } from '@/lib/inventory-actions';

const chip =
  'rounded-full border border-border/60 bg-background/35 px-2.5 py-1 text-[11px] font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]';
const iconButton =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-background/60 hover:text-foreground dark:hover:bg-white/[0.04]';
const action =
  'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-border/60 px-3 text-sm font-medium hover:bg-muted/60 disabled:opacity-45';
const gbp = (amount: number | null | undefined) =>
  typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? `£${amount.toFixed(2)}` : null;

/**
 * One owned card in Inventory: the card first (art, name, printing, grade, saved price), then where it is and a few
 * things you can do with it. Moving or removing it is a deliberate step with its consequence stated first.
 */
export default function InventoryDetail({
  row,
  cached,
  onClose,
  onOpenLocation,
  onEditGrading,
  ownership,
  labels,
  pricingRegion = 'UK',
}: {
  ownership?: InventoryOwnershipBinding;
  labels?: InventoryLabels;
  pricingRegion?: PricingRegion;
  onEditGrading?: () => void;
  row: InventoryBrowseRow;
  cached: boolean;
  onClose: () => void;
  onOpenLocation?: (intent: InventoryLocationIntent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(true, onClose, { containerRef: ref });
  const swipe = useSwipeToDismiss(ref, onClose);
  const [mode, setMode] = useState<'view' | 'move' | 'takeOut' | 'remove'>('view');
  const [menu, setMenu] = useState(false);
  const name = row.name ?? (row.speciesNames.join(', ') || 'Unknown card');
  const printing = [row.setName, row.number ? `#${row.number}` : null].filter(Boolean).join(' · ');
  const editable = Boolean(ownership?.available && labels && !cached);
  const placed = row.location.kind === 'assigned';
  return (
    <div className="fixed inset-0 z-40">
      <div
        data-overlay-backdrop
        aria-hidden="true"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} details`}
        tabIndex={-1}
        className="holo-panel border-border/70 bg-card/96 text-foreground absolute inset-x-2 bottom-[calc(var(--dock-clearance)+0.375rem)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-md flex-col overflow-hidden rounded-[1.35rem] border p-3 shadow-xl backdrop-blur-xl outline-none sm:rounded-[1.6rem] md:bottom-4"
      >
        <div data-sheet-grabber {...swipe} className="shrink-0">
          <div
            aria-hidden="true"
            className="bg-muted-foreground/30 mx-auto -mt-1 mb-2 h-1.5 w-10 rounded-full sm:hidden"
          />
          <div className="flex items-start gap-3">
            {row.image && (
              <CardImageZoom
                src={row.image}
                alt={name}
                className="trading-card border-border/60 bg-background/45 relative mt-0.5 w-[5.5rem] shrink-0 overflow-hidden rounded-lg border sm:w-24"
              >
                <CardImage
                  src={row.image}
                  alt={name}
                  fill
                  sizes="(max-width: 639px) 88px, 96px"
                  className="object-cover"
                />
              </CardImageZoom>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h2 className="min-w-0 text-[1.05rem] leading-tight font-bold tracking-tight [overflow-wrap:anywhere] break-words">
                  {name}
                </h2>
                <button type="button" aria-label="Close card details" onClick={onClose} className={iconButton}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              {printing && (
                <p className="text-muted-foreground mt-0.5 text-xs [overflow-wrap:anywhere] break-words">{printing}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {row.language && <span className={chip}>{formatCardLanguageLabel(row.language)}</span>}
                {row.finish && <span className={chip}>{formatCardFinishLabel(row.finish)}</span>}
                {row.graded && (
                  <span className={`${chip} text-foreground font-semibold`}>
                    {[row.provider, row.grade ?? 'Unknown grade'].filter(Boolean).join(' ')}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">
                  {row.location.kind === 'unassigned' ? 'Not in a binder' : inventoryLocationLabel(row.location)}
                </span>
              </p>
            </div>
          </div>
        </div>
        <div className="-mx-3 mt-3 -mb-3 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3 text-sm [&>*]:shrink-0">
          {mode === 'view' && (
            <>
              {((placed && onOpenLocation) || editable || onEditGrading) && (
                <div className="flex gap-2">
                  {placed && onOpenLocation && (
                    <button
                      type="button"
                      className={action}
                      onClick={() => {
                        if (row.location.kind === 'assigned') onOpenLocation({ ...row.location.intent });
                      }}
                    >
                      <MapPin className="h-4 w-4" aria-hidden />
                      Go to pocket
                    </button>
                  )}
                  {editable && (
                    <button type="button" className={action} onClick={() => setMode('move')}>
                      <ArrowLeftRight className="h-4 w-4" aria-hidden />
                      {placed ? 'Move' : 'Put in a binder'}
                    </button>
                  )}
                  {(editable || onEditGrading) && (
                    <button
                      type="button"
                      aria-label="More card options"
                      aria-haspopup="menu"
                      aria-expanded={menu}
                      className={`${action} max-w-11 flex-none px-0`}
                      onClick={() => setMenu((open) => !open)}
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              )}
              {menu && (
                <div
                  role="menu"
                  aria-label="Card options"
                  className="border-border/60 bg-background/40 grid gap-0.5 rounded-2xl border p-1"
                >
                  {editable && placed && (
                    <button
                      type="button"
                      role="menuitem"
                      className="hover:bg-muted/70 flex min-h-11 items-center rounded-xl px-3 text-left text-sm font-medium"
                      onClick={() => {
                        setMenu(false);
                        setMode('takeOut');
                      }}
                    >
                      Take out of its binder
                    </button>
                  )}
                  {onEditGrading && row.cardId && (
                    <button
                      type="button"
                      role="menuitem"
                      className="hover:bg-muted/70 flex min-h-11 items-center rounded-xl px-3 text-left text-sm font-medium"
                      onClick={onEditGrading}
                    >
                      {row.graded ? 'Edit grading' : 'Add grading'}
                    </button>
                  )}
                </div>
              )}
              {row.cardId && isCardLanguage(row.language) && (
                <NativeCardPrice
                  cardId={row.cardId}
                  language={row.language}
                  finish={isCardFinish(row.finish) ? row.finish : undefined}
                  name={name}
                  setName={row.setName ?? undefined}
                  localId={row.number ?? undefined}
                  pricing={{
                    region: pricingRegion,
                    formatAmount: gbp,
                    formatRange: (low, high) => (gbp(low) && gbp(high) ? `${gbp(low)}-${gbp(high)}` : null),
                  }}
                />
              )}
              {row.graded && (
                <p className="text-muted-foreground text-xs">
                  Prices shown are for an ungraded copy. A graded card&apos;s value isn&apos;t estimated.
                </p>
              )}
              {editable &&
                (row.graded ? (
                  <p className="text-muted-foreground text-xs">
                    A graded card can&apos;t be removed from your collection here. You can still move it or take it out
                    of its binder.
                  </p>
                ) : (
                  <button
                    type="button"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-2xl border px-3 text-sm font-medium"
                    onClick={() => {
                      setMenu(false);
                      setMode('remove');
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Remove from collection
                  </button>
                ))}
            </>
          )}
          {mode === 'move' && ownership && labels && (
            <InventoryMove
              binding={ownership}
              labels={labels}
              itemId={row.itemId}
              onAccepted={onClose}
              onCancel={() => setMode('view')}
            />
          )}
          {(mode === 'takeOut' || mode === 'remove') && ownership && (
            <Confirm
              binding={ownership}
              itemId={row.itemId}
              kind={mode}
              name={name}
              placed={placed}
              onAccepted={onClose}
              onCancel={() => setMode('view')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Confirm({
  binding,
  itemId,
  kind,
  name,
  placed,
  onAccepted,
  onCancel,
}: {
  binding: InventoryOwnershipBinding;
  itemId: string;
  kind: 'takeOut' | 'remove';
  name: string;
  placed: boolean;
  onAccepted: () => void;
  onCancel: () => void;
}) {
  const save = useInventorySave(binding, onAccepted);
  const removing = kind === 'remove';
  return (
    <section aria-label={removing ? 'Remove card' : 'Take card out'} className="space-y-3">
      <p className="text-sm font-semibold">
        {removing ? `Remove ${name} from your collection?` : `Take ${name} out of its binder?`}
      </p>
      <p className="text-muted-foreground text-sm">
        {removing
          ? `This removes the card itself${placed ? ', and its pocket becomes empty' : ''}. Your other copies aren't affected. This can't be undone with one tap.`
          : 'The card stays in your collection. Its pocket becomes empty and keeps its place.'}
      </p>
      {save.error && (
        <div role="alert" className="border-destructive/40 bg-destructive/10 rounded-2xl border p-3 text-sm">
          <p className="break-words">{save.error}</p>
          {save.pending && (
            <button
              type="button"
              className="border-border mt-2 min-h-10 rounded-xl border px-3 text-sm font-medium"
              disabled={save.busy}
              onClick={save.retry}
            >
              Try again
            </button>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="border-border/70 min-h-11 flex-1 rounded-2xl border px-3 text-sm font-medium"
          disabled={save.busy}
          onClick={onCancel}
        >
          Keep it
        </button>
        {!save.pending && (
          <button
            type="button"
            disabled={save.busy}
            onClick={() => save.run({ kind: removing ? 'removeOwned' : 'unassign', itemId })}
            className={`min-h-11 flex-1 rounded-2xl px-3 text-sm font-semibold disabled:opacity-45 ${removing ? 'bg-destructive text-white' : 'bg-primary text-primary-foreground'}`}
          >
            {save.busy ? (removing ? 'Removing…' : 'Taking out…') : removing ? 'Remove card' : 'Take it out'}
          </button>
        )}
      </div>
    </section>
  );
}
