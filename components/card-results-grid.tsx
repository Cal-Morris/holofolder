'use client';

/**
 * One card results grid for Add a card (the card picker), the Search sheet and an illustrator's cards, so they look and
 * sort the same. The picker keeps its own pick, scan, finish and several-cards logic and passes it in through the tile's
 * `mark`, `corner`, `action` and button props; the others use `useCardResultsFilters` and `CardResultsControls` for
 * sort and filters.
 */
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Check, Heart, SlidersHorizontal, X } from 'lucide-react';
import CardImage from '@/components/card-image';
import CardPickerFiltersSheet from '@/components/card-picker-filters-sheet';
import { PriceRisingBadge } from '@/components/price-rising-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toCardImageSrc } from '@/lib/card-image-url';
import type { CardPickerFilterChip, CardPickerFilterKey } from '@/lib/card-picker-filters';
import type { CardPriceSnapshot } from '@/lib/card-pricing';
import type { cardResultPriceLabels } from '@/lib/card-results';
import type { useCardResultsFilters } from '@/hooks/use-card-results-filters';
import { cn } from '@/lib/utils';

const GRID_CLASS = 'grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-5';

/** A card image (or "No Image"), with an optional holo shimmer until it loads; the parent must be positioned for it. */
export function CardResultImage({
  src,
  sizes = '(max-width: 639px) 45vw, 180px',
  alt,
  className,
  fallbackClassName = 'flex h-full w-full items-center justify-center bg-muted',
  shimmer = false,
}: {
  src?: string;
  sizes?: string;
  alt: string;
  className: string;
  fallbackClassName?: string;
  shimmer?: boolean;
}) {
  // Remembers which src failed, so a new src gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string>();
  const failed = failedSrc !== undefined && failedSrc === src;
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const imageSrc = toCardImageSrc(src);

  if (!imageSrc || failed) {
    return (
      <div className={fallbackClassName}>
        <span className="text-muted-foreground text-xs">No Image</span>
      </div>
    );
  }

  // The original URL, not the CDN one: CardImage falls back to the proxy (which mirrors the miss) only from the original.
  // The holo shimmer shows until the image arrives, then goes so hundreds of tiles don't keep animating.
  return (
    <>
      {shimmer && loadedSrc !== src && <Skeleton className="absolute inset-0 rounded-[inherit]" />}
      <CardImage
        sizes={sizes}
        src={src!}
        alt={alt}
        className={className}
        loading="lazy"
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailedSrc(src)}
      />
    </>
  );
}

/** The grid; with `label` it is a named list, for tiles in list-item mode (see `CardResultTile`'s `footer`). */
export function CardResultsGrid({
  busy = false,
  label,
  children,
}: {
  busy?: boolean;
  label?: string;
  children: ReactNode;
}) {
  const className = cn(GRID_CLASS, 'transition-opacity', busy && 'opacity-50');
  return label ? (
    <ul aria-label={label} aria-busy={busy} className={className}>
      {children}
    </ul>
  ) : (
    <div aria-busy={busy} className={className}>
      {children}
    </div>
  );
}

export function CardResultsSkeleton({ count = 20 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading cards" className={GRID_CLASS}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} aria-hidden="true" className="bg-card overflow-hidden rounded-xl border-2 border-transparent">
          <Skeleton variant="card" className="aspect-[63/88] w-full rounded-[10px]" />
          <div className="space-y-1.5 p-1.5 sm:p-2">
            <Skeleton className="h-2.5 w-3/4" />
            <Skeleton className="h-2 w-1/2" />
            <div className="grid h-[1.125rem] grid-cols-2 gap-1 sm:h-5">
              <Skeleton className="rounded-md" />
              <Skeleton className="rounded-md" />
            </div>
            <Skeleton className="h-2 w-1/4" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading cards…</span>
    </div>
  );
}

/** The Owned / Wanted mark in a tile's top-right corner. */
export function CardStandingMark({
  standing,
  count,
}: {
  standing: 'owned' | 'wanted';
  /** Copies, when known. */ count?: number;
}) {
  return standing === 'wanted' ? (
    <div className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full border border-amber-400/60 bg-black/70 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.06em] text-amber-300 uppercase">
      <Heart className="h-2.5 w-2.5 fill-current" />
      Wanted{count && count > 1 ? ` ×${count}` : ''}
    </div>
  ) : (
    <div className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full border border-emerald-400/60 bg-black/70 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.06em] text-emerald-300 uppercase">
      <Check className="h-2.5 w-2.5" />
      Owned{count && count > 1 ? ` ×${count}` : ''}
    </div>
  );
}

interface CardResultTileProps extends Omit<ComponentProps<'button'>, 'type'> {
  card: { name: string; image?: string; localId: string; set: { name: string } };
  /** The card's name above its set; a slot's picker, where every card is the same Pokémon, leaves it out. */
  showName?: boolean;
  /** Shown under the set when the name is left out (a printing named differently, such as "Pikachu (Cosplay)"). */
  subtitle?: string | null;
  price?: CardPriceSnapshot;
  priceLabels: ReturnType<typeof cardResultPriceLabels>;
  pricesLoading?: boolean;
  /** After the number: the printing's language, when results mix languages. */
  languageTag?: string;
  /** Bottom-right: what a tap does in the picker (Add or Want), in its colour. */
  intent?: { label: string; wanted: boolean; className: string };
  /** Border classes: the picker's selected or hover colour. */
  highlight?: string;
  /**
   * List-item mode, for tiles with buttons of their own (Want, Add): the tile is a named `<li>` in a labelled
   * `CardResultsGrid`, one cover button (these props, when there is an `onClick`) opens the card, and `footer` sits
   * above it.
   */
  listItem?: { label: string; cardId?: string; footer?: ReactNode };
}

/** One card in the grid: art and mark, name and set, both price lines (fixed height), range and confidence, number. */
export function CardResultTile({
  card,
  showName = true,
  subtitle,
  price,
  priceLabels,
  pricesLoading = false,
  languageTag,
  intent,
  highlight = 'border-transparent',
  className,
  children,
  listItem,
  ...button
}: CardResultTileProps) {
  const tileClass = cn(
    'group/card bg-card focus-visible:ring-primary/70 relative flex min-w-0 flex-col justify-start overflow-hidden rounded-xl border-2 text-left transition-[background-color,border-color,transform,scale] select-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:outline-none aria-disabled:opacity-45 sm:hover:scale-[1.03]',
    highlight,
    className,
  );
  const body = (
    <>
      <div className="trading-card bg-muted relative w-full">
        <CardResultImage
          src={card.image}
          alt={card.name}
          className="absolute inset-0 h-full w-full object-cover"
          shimmer
        />
        {/* Marks over the art (a pick number, Current, Owned, Wanted, a scan match); without one, a rising price. */}
        {children ?? <PriceRisingBadge price={price} className="absolute top-1.5 right-1.5" />}
      </div>
      <div className="p-1.5 sm:p-2">
        {showName && <p className="text-foreground truncate text-[11px] font-semibold sm:text-xs">{card.name}</p>}
        <p
          className={`truncate text-[10px] sm:text-xs ${showName ? 'text-muted-foreground' : 'text-foreground font-semibold'}`}
        >
          {card.set.name}
        </p>
        {!showName && subtitle && <p className="text-foreground mt-0.5 text-[10px]">{subtitle}</p>}
        {/* Both price lines keep their height while loading, loaded or missing, so tiles never jump. */}
        <div
          className="mt-1 grid h-[1.125rem] grid-cols-2 gap-1 text-[9px] leading-[1.125rem] font-semibold tabular-nums sm:h-5 sm:text-[10px] sm:leading-5"
          data-price-line
        >
          {priceLabels.good || priceLabels.market || !pricesLoading ? (
            <>
              <span className="bg-muted truncate rounded-md px-1 text-emerald-600 dark:text-emerald-300">
                L {priceLabels.good ?? '-'}
              </span>
              <span className="bg-muted text-foreground truncate rounded-md px-1">M {priceLabels.market ?? '-'}</span>
            </>
          ) : (
            <>
              <Skeleton className="rounded-md" />
              <Skeleton className="rounded-md" />
              <span className="sr-only">Loading price</span>
            </>
          )}
        </div>
        <p className="text-muted-foreground mt-1 h-3 truncate text-[9px] leading-3" data-price-range>
          {[priceLabels.range ? `R ${priceLabels.range}` : null, priceLabels.confidence].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-1 flex items-center justify-between gap-1">
          <p className="text-muted-foreground text-[9px] sm:text-[10px]">
            #{card.localId}
            {languageTag && <span className="ml-1 font-semibold uppercase">{languageTag}</span>}
          </p>
          {intent && (
            <span
              aria-hidden="true"
              className={`flex items-center gap-0.5 text-[9px] font-bold uppercase sm:text-[10px] ${intent.className}`}
            >
              {intent.wanted ? <Heart className="h-2.5 w-2.5 fill-current" /> : <Check className="h-2.5 w-2.5" />}
              {intent.label}
            </span>
          )}
        </div>
      </div>
    </>
  );
  if (!listItem) {
    return (
      <button type="button" {...button} className={tileClass}>
        {body}
      </button>
    );
  }
  return (
    <li aria-label={listItem.label} data-card-id={listItem.cardId} className={tileClass}>
      {button.onClick ? (
        <button
          type="button"
          {...button}
          className="focus-visible:ring-primary/70 absolute inset-0 z-[1] rounded-[inherit] focus-visible:ring-2 focus-visible:outline-none"
        />
      ) : null}
      {body}
      {listItem.footer ? (
        <div className="relative z-[2] mt-auto px-1.5 pb-1.5 sm:px-2 sm:pb-2">{listItem.footer}</div>
      ) : null}
    </li>
  );
}

/** The "Filters · Sort" button, with how many filters are on. */
export function CardResultsFiltersButton({
  activeCount,
  onOpen,
  className,
}: {
  activeCount: number;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={cn(
        'flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border px-3 text-xs font-semibold transition-colors',
        activeCount > 0
          ? 'border-primary/45 bg-primary/12 text-primary'
          : 'border-border/60 bg-background/85 text-foreground hover:bg-muted/60',
        className,
      )}
    >
      <SlidersHorizontal className="h-4 w-4" />
      <span>Filters · Sort</span>
      {activeCount > 0 && (
        <span className="bg-primary text-primary-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px]">
          {activeCount}
        </span>
      )}
    </button>
  );
}

/** The filters that are on, each removable, and Clear all once there are several. */
export function ActiveFilterChips({
  chips,
  onClear,
  onClearAll,
  className,
}: {
  chips: readonly CardPickerFilterChip[];
  onClear: (key: CardPickerFilterKey) => void;
  onClearAll: () => void;
  className?: string;
}) {
  if (chips.length === 0) return null;
  return (
    <div
      role="list"
      aria-label="Active filters"
      className={cn('scrollbar-hide flex items-center gap-1.5 overflow-x-auto', className)}
    >
      {chips.map((chip) => (
        <span role="listitem" key={chip.key} className="shrink-0">
          <button
            type="button"
            onClick={() => onClear(chip.key)}
            aria-label={`Remove filter ${chip.label}`}
            className="border-primary/35 bg-primary/10 text-primary flex h-9 items-center gap-1 rounded-full border pr-2 pl-3 text-xs font-semibold"
          >
            <span className="max-w-[10rem] truncate">{chip.label}</span>
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-muted-foreground hover:text-foreground h-9 shrink-0 rounded-full px-3 text-xs font-semibold"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

/**
 * Filters · Sort and its sheet (sort, Pokémon, set, rarity and artist) for a grid that filters with
 * `useCardResultsFilters`. The active filters show under the button.
 */
export function CardResultsControls({
  results,
  className,
}: {
  results: ReturnType<typeof useCardResultsFilters>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CardResultsFiltersButton activeCount={results.chips.length} onOpen={() => setOpen(true)} className={className} />
      {open && (
        <CardPickerFiltersSheet
          sort={results.sort}
          onSortChange={results.setSort}
          pokemon={results.filters.pokemon}
          pokemonOptions={results.options.pokemon}
          onPokemonChange={(pokemon) => results.setFilter({ pokemon })}
          set={results.filters.set}
          sets={results.options.sets}
          onSetChange={(set) => results.setFilter({ set })}
          rarity={results.filters.rarity}
          rarities={results.options.rarities}
          onRarityChange={(rarity) => results.setFilter({ rarity })}
          illustrator={results.filters.illustrator}
          illustrators={results.options.illustrators.length > 1 ? results.options.illustrators : undefined}
          onIllustratorChange={
            results.options.illustrators.length > 1 ? (illustrator) => results.setFilter({ illustrator }) : undefined
          }
          resultCount={results.visible.length}
          onReset={results.reset}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
