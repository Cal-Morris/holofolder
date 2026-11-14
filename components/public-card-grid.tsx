'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import CardImage from '@/components/card-image';
import { CardGridArt, CardGridBody, CardGridTile } from '@/components/card-grid-tile';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import {
  facetOptions,
  filterCatalogueCards,
  type CatalogueCard,
  type CatalogueFacet,
  type CatalogueFilter,
  type CatalogueSort,
} from '@/lib/catalogue-cards';
import { toBinderPages } from '@/lib/set-pages';
import type { PublicCardLinks } from '@/components/public-card-detail';

const PublicCardDetail = dynamic(() => import('@/components/public-card-detail'), { ssr: false });

const FACET_LABELS: Record<CatalogueFacet, string> = {
  rarity: 'Rarity',
  illustrator: 'Illustrator',
  series: 'Era',
  setName: 'Set',
};

const VIEWS = [
  { value: 'cards', label: 'Cards' },
  { value: 'pages', label: 'Binder pages' },
] as const;

const cardLabel = (card: CatalogueCard) => `${card.name} ${card.number} ${card.setName}`;

const TILE_SIZES = '(max-width: 639px) 31vw, (max-width: 767px) 23vw, (max-width: 1023px) 18vw, 180px';

/**
 * The public catalogue's card grid (set, Pokémon and illustrator pages): every card server-rendered in the page's
 * order, with filters, sort and a binder-page view applied in the browser, and a read-only detail sheet per card.
 * `meta` picks the tile's second line: the set (pages that mix sets) or the rarity (a set's own page).
 */
export function PublicCardGrid({
  cards,
  label,
  facets,
  sortLabels,
  meta,
  pages = false,
  links,
}: {
  cards: CatalogueCard[];
  /** The list's accessible name, e.g. "Surging Sparks cards". */
  label: string;
  facets: readonly CatalogueFacet[];
  sortLabels: { default: string; reverse: string };
  meta: 'set' | 'rarity';
  /** Offer the cards as nine-pocket binder pages too. */
  pages?: boolean;
  links: PublicCardLinks;
}) {
  const [filter, setFilter] = useState<CatalogueFilter>({});
  const [view, setView] = useState<'cards' | 'pages'>('cards');
  const [open, setOpen] = useState<CatalogueCard | null>(null);

  const options = useMemo(
    () =>
      facets.flatMap((facet) => {
        const values = facetOptions(cards, facet);
        return values.length > 1 ? [{ facet, values }] : [];
      }),
    [cards, facets],
  );
  const visible = useMemo(() => filterCatalogueCards(cards, filter), [cards, filter]);
  const filtered = visible.length !== cards.length;

  return (
    <section aria-label={label} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative basis-full sm:min-w-[12rem] sm:flex-1 sm:basis-auto">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            type="search"
            aria-label="Filter by name or number"
            value={filter.text ?? ''}
            onChange={(event) => setFilter((current) => ({ ...current, text: event.target.value }))}
            placeholder="Name or number"
            className="h-11 rounded-2xl pl-9"
          />
        </div>
        {options.map(({ facet, values }) => (
          <Select
            key={facet}
            aria-label={`Filter by ${FACET_LABELS[facet].toLowerCase()}`}
            value={filter.facets?.[facet] ?? ''}
            onChange={(event) =>
              setFilter((current) => ({ ...current, facets: { ...current.facets, [facet]: event.target.value } }))
            }
            className="min-w-0 flex-1 sm:w-48 sm:flex-none"
          >
            <option value="">{FACET_LABELS[facet]}: all</option>
            {values.map(({ value, count }) => (
              <option key={value} value={value}>
                {value} ({count})
              </option>
            ))}
          </Select>
        ))}
        <Select
          aria-label="Sort cards"
          value={filter.sort ?? 'default'}
          onChange={(event) => setFilter((current) => ({ ...current, sort: event.target.value as CatalogueSort }))}
          className="min-w-0 flex-1 sm:w-48 sm:flex-none"
        >
          <option value="default">{sortLabels.default}</option>
          <option value="reverse">{sortLabels.reverse}</option>
          <option value="name">Name</option>
        </Select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground flex min-h-9 items-center gap-3 text-sm" aria-live="polite">
          {filtered ? `${visible.length} of ${cards.length} cards` : `${cards.length} cards`}
          {filtered && (
            <button
              type="button"
              onClick={() => setFilter((current) => ({ sort: current.sort }))}
              className="text-primary inline-flex min-h-9 items-center font-medium underline-offset-2 hover:underline"
            >
              Clear filters
            </button>
          )}
        </p>
        {pages && <SegmentedControl value={view} options={VIEWS} onChange={setView} label="Show cards as" />}
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground flex h-40 items-center justify-center text-center text-sm">
          No cards match that filter.
        </p>
      ) : view === 'pages' ? (
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {toBinderPages(visible).map((page, i) => (
            <li key={page[0].id} className="holo-panel space-y-2 rounded-2xl p-3">
              <h3 className="text-muted-foreground text-xs font-semibold">Page {i + 1}</h3>
              <div className="grid grid-cols-3 gap-1.5">
                {page.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    aria-label={`Open ${cardLabel(card)}`}
                    onClick={() => setOpen(card)}
                    className="trading-card bg-muted/40 focus-visible:ring-primary/70 relative block w-full focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {card.image && (
                      <CardImage
                        src={card.image}
                        alt={cardLabel(card)}
                        sizes="(max-width: 639px) 30vw, 120px"
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6">
          {visible.map((card) => (
            <CardGridTile key={card.id} onOpen={() => setOpen(card)} openLabel={`Open ${cardLabel(card)}`}>
              <CardGridArt image={card.image} alt={cardLabel(card)} sizes={TILE_SIZES} />
              <CardGridBody>
                <p className="truncate text-xs font-semibold" title={card.name}>
                  {card.name}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {(meta === 'set' ? card.setName : card.rarity) || '\u00a0'}
                </p>
                <p className="text-muted-foreground truncate text-xs tabular-nums">{card.number}</p>
              </CardGridBody>
            </CardGridTile>
          ))}
        </ul>
      )}
      {open && <PublicCardDetail card={open} links={links} onOpenCard={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}
