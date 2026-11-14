'use client';

import { BarChart3, Camera, Grid3X3, Heart, Layers3, ListChecks, Settings, Sparkles, Ticket } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { QuickDestination, QuickDestinationId } from '@/lib/quick-mode';

const DESTINATION_ICONS: Record<QuickDestinationId, LucideIcon> = {
  binder: Grid3X3,
  list: ListChecks,
  wanted: Heart,
  sets: Layers3,
  pokemon: Sparkles,
  analytics: BarChart3,
  settings: Settings,
  scan: Camera,
  'show-mode': Ticket,
};

/** Quick mode's and Search's "Go to" section: a grid of app destinations, or matching rows while searching. */
export default function QuickDestinations({
  destinations,
  asRows,
  columns = 2,
  onGo,
}: {
  destinations: readonly QuickDestination[];
  /** Rows (while a query is typed) instead of the grid. */
  asRows: boolean;
  columns?: 2 | 3;
  onGo: (destination: QuickDestinationId) => void;
}) {
  if (destinations.length === 0) return null;
  return (
    <section aria-label="Go to">
      <h3 className="text-muted-foreground px-1 pt-3 pb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase">
        Go to
      </h3>
      <div className={asRows ? '' : `grid ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-2 px-1`}>
        {destinations.map((destination) => {
          const Icon = DESTINATION_ICONS[destination.id];
          return (
            <button
              key={destination.id}
              type="button"
              onClick={() => onGo(destination.id)}
              className={
                asRows
                  ? 'hover:bg-muted/60 focus-visible:bg-muted/60 active:bg-muted flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors focus-visible:outline-none'
                  : 'border-border/60 bg-card active:bg-muted flex min-h-16 items-center gap-2.5 rounded-2xl border px-3 text-left'
              }
            >
              <span className="bg-primary/12 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold">{destination.label}</span>
                <span className="text-muted-foreground block truncate text-[11px]">{destination.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
