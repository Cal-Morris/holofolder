'use client';

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import {
  WANTED_SORTS,
  toggleWantedFilter,
  type WantedDashboardBreakdown,
  type WantedDashboardPriceBand,
  type WantedDashboardSort,
  type WantedFilters,
} from '@/lib/wanted-dashboard';

interface WantedFiltersSheetProps {
  sort: WantedDashboardSort;
  onSortChange: (sort: WantedDashboardSort) => void;
  filters: WantedFilters;
  onFiltersChange: (filters: WantedFilters) => void;
  priceBands: WantedDashboardPriceBand[];
  sets: WantedDashboardBreakdown[];
  finishes: WantedDashboardBreakdown[];
  languages: WantedDashboardBreakdown[];
  risingCount: number;
  dropCount: number;
  resultCount: number;
  onReset: () => void;
  onClose: () => void;
}

function chipClass(selected: boolean) {
  return `flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors ${
    selected
      ? 'border-primary/45 bg-primary/12 text-primary'
      : 'border-border/55 bg-background/65 text-muted-foreground hover:text-foreground'
  }`;
}

/**
 * Sort and filters for the want list in one bottom sheet, on the shared overlay primitive
 * (Escape/back closes it, focus is trapped and returned, swipe down to dismiss).
 */
export default function WantedFiltersSheet(props: WantedFiltersSheetProps) {
  const { onClose, filters, onFiltersChange } = props;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useOverlay(true, onClose, { containerRef: sheetRef });
  const swipe = useSwipeToDismiss(sheetRef, onClose);

  if (typeof document === 'undefined') return null;

  const group = (legend: string, children: React.ReactNode) => (
    <fieldset className="space-y-1.5">
      <legend className="text-muted-foreground mb-1.5 text-xs font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );

  return createPortal(
    <div data-overlay-backdrop className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Sort and filter want list"
        className="border-border/65 bg-card absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-[1.6rem] border-t pt-3 pr-[calc(env(safe-area-inset-right)+1rem)] pb-[calc(var(--safe-bottom)+0.75rem)] pl-[calc(env(safe-area-inset-left)+1rem)] shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] outline-none sm:bottom-4 sm:rounded-[1.6rem] sm:border"
        onClick={(event) => event.stopPropagation()}
      >
        <div data-sheet-grabber className="-mx-4 -mt-3 shrink-0 px-4 pt-3" {...swipe}>
          <div aria-hidden="true" className="bg-muted-foreground/30 mx-auto mb-2 h-1.5 w-10 rounded-full" />
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Sort &amp; filter</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sort and filter"
              className="text-muted-foreground hover:bg-muted/70 hover:text-foreground -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pb-2">
          <fieldset>
            <legend className="text-muted-foreground mb-1.5 text-xs font-semibold">Sort by</legend>
            <div
              role="radiogroup"
              aria-label="Sort by"
              className="border-border/60 overflow-hidden rounded-2xl border dark:border-white/10"
            >
              {WANTED_SORTS.map((option) => {
                const selected = props.sort === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => props.onSortChange(option.id)}
                    className={`border-border/50 flex min-h-11 w-full items-center justify-between gap-2 border-b px-3.5 text-left text-sm last:border-b-0 dark:border-white/10 ${selected ? 'bg-primary/8 text-primary font-semibold' : ''}`}
                  >
                    {option.label}
                    {selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {group(
            'Price',
            props.priceBands
              .filter((band) => band.count > 0)
              .map((band) => (
                <button
                  key={band.id}
                  type="button"
                  aria-pressed={filters.bands.includes(band.id)}
                  onClick={() => onFiltersChange(toggleWantedFilter(filters, 'bands', band.id))}
                  className={chipClass(filters.bands.includes(band.id))}
                >
                  {band.label} <span className="tabular-nums opacity-70">{band.count}</span>
                </button>
              )),
          )}

          {props.risingCount > 0 || props.dropCount > 0 || filters.risingOnly || filters.dropsOnly
            ? group(
                'Trend',
                <>
                  {props.dropCount > 0 || filters.dropsOnly ? (
                    <button
                      type="button"
                      aria-pressed={filters.dropsOnly}
                      onClick={() => onFiltersChange({ ...filters, dropsOnly: !filters.dropsOnly })}
                      className={chipClass(filters.dropsOnly)}
                    >
                      Price drops <span className="tabular-nums opacity-70">{props.dropCount}</span>
                    </button>
                  ) : null}
                  {props.risingCount > 0 || filters.risingOnly ? (
                    <button
                      type="button"
                      aria-pressed={filters.risingOnly}
                      onClick={() => onFiltersChange({ ...filters, risingOnly: !filters.risingOnly })}
                      className={chipClass(filters.risingOnly)}
                    >
                      Rising only <span className="tabular-nums opacity-70">{props.risingCount}</span>
                    </button>
                  ) : null}
                </>,
              )
            : null}

          {group(
            'Set',
            props.sets.map((set) => (
              <button
                key={set.label}
                type="button"
                aria-pressed={filters.sets.includes(set.label)}
                onClick={() => onFiltersChange(toggleWantedFilter(filters, 'sets', set.label))}
                className={chipClass(filters.sets.includes(set.label))}
              >
                {set.label} <span className="tabular-nums opacity-70">{set.count}</span>
              </button>
            )),
          )}

          {props.finishes.length > 1
            ? group(
                'Variant',
                props.finishes.map((finish) => (
                  <button
                    key={finish.label}
                    type="button"
                    aria-pressed={filters.finishes.includes(finish.label)}
                    onClick={() => onFiltersChange(toggleWantedFilter(filters, 'finishes', finish.label))}
                    className={chipClass(filters.finishes.includes(finish.label))}
                  >
                    {formatCardFinishLabel(finish.label)}{' '}
                    <span className="tabular-nums opacity-70">{finish.count}</span>
                  </button>
                )),
              )
            : null}

          {props.languages.length > 1
            ? group(
                'Language',
                props.languages.map((language) => (
                  <button
                    key={language.label}
                    type="button"
                    aria-pressed={filters.languages.includes(language.label)}
                    onClick={() => onFiltersChange(toggleWantedFilter(filters, 'languages', language.label))}
                    className={chipClass(filters.languages.includes(language.label))}
                  >
                    {formatCardLanguageLabel(language.label)}{' '}
                    <span className="tabular-nums opacity-70">{language.count}</span>
                  </button>
                )),
              )
            : null}
        </div>

        <div className="mt-2 grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
          <button
            type="button"
            onClick={props.onReset}
            className="border-border/60 text-muted-foreground hover:text-foreground h-11 rounded-2xl border px-4 text-sm font-semibold"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            className="bg-primary text-primary-foreground h-11 rounded-2xl px-4 text-sm font-semibold"
          >
            Show {props.resultCount} {props.resultCount === 1 ? 'card' : 'cards'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
