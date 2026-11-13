'use client';

import { BookOpen, Check, Trash2 } from 'lucide-react';
import { OverlayCloseButton, OverlayDialog, OverlayGrabber } from '@/components/ui/overlay-dialog';
import type { WantedLocation } from '@/lib/wanted-dashboard';

interface WantedRowActionsSheetProps {
  cardName: string;
  detail: string;
  readOnlyMode: boolean;
  onGot: () => void;
  onShowInBinder: (() => void) | null;
  onRemove: () => void;
  onClose: () => void;
  gotLabel?: string;
  locations?: WantedLocation[];
  onOpenBinder?: (binderId: string) => void;
  peopleLabel?: (ids: string[] | undefined) => string;
  assignment?: {
    selected: string[] | undefined;
    viewerId: string;
    partnerId: string | null;
    partnerLabel: string;
    onChange: (ids: string[]) => void;
  };
}

/** The small per-card menu on the want list, as a bottom sheet so every action is a 44px+ row. */
export default function WantedRowActionsSheet(props: WantedRowActionsSheetProps) {
  const { onClose } = props;
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const rowClass =
    'flex min-h-12 w-full items-center gap-3 border-b border-border/50 px-4 text-left text-sm font-semibold last:border-b-0 active:bg-muted/60 dark:border-white/10';

  return (
    <OverlayDialog
      onClose={onClose}
      aria-label={`Actions for ${props.cardName}`}
      className="bottom-[var(--dock-clearance)] max-h-[calc(100dvh-env(safe-area-inset-top)-var(--dock-clearance)-1rem)] overflow-y-auto pt-3 pr-[calc(env(safe-area-inset-right)+1rem)] pb-[calc(var(--safe-bottom)+0.75rem)] pl-[calc(env(safe-area-inset-left)+1rem)] sm:bottom-[var(--dock-clearance)] md:bottom-4"
    >
      <div data-sheet-grabber className="bg-card sticky top-0 z-10 -mx-4 -mt-3 px-4 pt-3">
        <OverlayGrabber />
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold">{props.cardName}</p>
          <OverlayCloseButton
            label="Close wanted card actions"
            onClick={onClose}
            className="h-9 w-9 rounded-none hover:bg-transparent"
          />
        </div>
        <p className="text-muted-foreground mb-3 truncate text-xs">{props.detail}</p>
      </div>
      {props.locations?.length ? (
        <section aria-label="Wanted in binders" className="mb-3 space-y-2">
          {props.locations.map((location) => (
            <div
              key={`${location.binderId}:${location.pokemonId}`}
              className="bg-muted/50 flex items-center justify-between gap-2 rounded-xl px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium break-words">{location.binderName}</p>
                <p className="text-muted-foreground text-sm break-words">
                  {props.peopleLabel?.(location.card.wanted_by)}
                </p>
              </div>
              <button
                type="button"
                onClick={run(() => props.onOpenBinder?.(location.binderId))}
                className="min-h-10 shrink-0 rounded-lg border px-3 text-sm"
              >
                Open {location.binderName}
              </button>
            </div>
          ))}
        </section>
      ) : null}
      {props.assignment && (
        <div role="group" aria-label="Wanted by" className="mb-3 space-y-2">
          <p className="text-sm font-medium">Wanted by</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'You', ids: [props.assignment.viewerId] },
              ...(props.assignment.partnerId
                ? [
                    { label: props.assignment.partnerLabel, ids: [props.assignment.partnerId] },
                    { label: 'Both', ids: [props.assignment.viewerId, props.assignment.partnerId] },
                  ]
                : []),
              { label: 'Unassigned', ids: [] },
            ].map((choice) => (
              <button
                key={choice.label}
                type="button"
                aria-pressed={
                  JSON.stringify((props.assignment?.selected ?? []).toSorted()) ===
                  JSON.stringify(choice.ids.toSorted())
                }
                onClick={() => props.assignment?.onChange(choice.ids)}
                className="aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground min-h-10 rounded-full border px-3 text-sm"
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="border-border/60 overflow-hidden rounded-2xl border dark:border-white/10">
        {props.readOnlyMode ? null : (
          <button
            type="button"
            onClick={run(props.onGot)}
            className={`${rowClass} text-emerald-700 dark:text-emerald-300`}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {props.gotLabel ?? 'Got it, move to my binder'}
          </button>
        )}
        {props.onShowInBinder ? (
          <button type="button" onClick={run(props.onShowInBinder)} className={rowClass}>
            <BookOpen className="text-muted-foreground h-4 w-4" aria-hidden="true" />
            Show in binder
          </button>
        ) : null}
        {props.readOnlyMode ? null : (
          <button type="button" onClick={run(props.onRemove)} className={`${rowClass} text-destructive`}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Remove from want list
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="border-border/60 text-muted-foreground mt-2 h-11 w-full rounded-2xl border text-sm font-semibold dark:border-white/10"
      >
        Cancel
      </button>
    </OverlayDialog>
  );
}
