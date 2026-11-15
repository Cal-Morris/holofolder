'use client';

import { useId, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OptionRow } from '@/components/ui/option-row';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { PageArtLayer } from '@/components/binder/page-art-layer';
import { TRADING_CARD_CORNER_RADIUS } from '@/components/binder/pokemon-slot';
import { useCardSearch } from '@/hooks/use-card-search';
import { toCardThumbnailSrc } from '@/lib/card-image-url';
import type { ArtworkFrame } from '@/lib/binder-design';
import {
  pageArtCardImageKey,
  rectFromCorners,
  type PageArtRect,
  type PageArtSlice,
  type PageArtSource,
  type PlacedPageArt,
} from '@/lib/page-art';
import { POKEMON_CATALOG, formatPokemonDisplayName, getOfficialArtworkUrl } from '@/lib/pokemon-catalog';
import { PAPER, defaultPaper, type PaperSize } from '@/lib/print-placeholders';
import type { PageArtPrintJob } from '@/components/page-art-print';

const PageArtPrint = dynamic(() => import('@/components/page-art-print'), { ssr: false });

export type PageArtTab = 'card' | 'pokemon' | 'upload';

const pageArtGroup = (legend: string, children: React.ReactNode, className = 'space-y-1.5') => (
  <fieldset>
    <legend className="text-muted-foreground mb-1.5 text-xs font-semibold">{legend}</legend>
    <div className={className}>{children}</div>
  </fieldset>
);

const cellAt = (x: number, y: number) => {
  const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-art-cell]');
  return cell ? Number(cell.dataset.artCell) : null;
};
const contains = (rect: PageArtRect, index: number, cols: number) => {
  const r = Math.floor(index / cols),
    c = index % cols;
  return r >= rect.row && r < rect.row + rect.rows && c >= rect.col && c < rect.col + rect.cols;
};

/**
 * The page as a small grid of pockets with its pictures. Drag across pockets, or tap two corners, to pick an area;
 * tapping a saved picture (before marking a corner) edits it.
 */
export function PocketPicker({
  rows,
  cols,
  pageSlots,
  preview,
  saved,
  editingId,
  rect,
  imageFor,
  onRect,
  onEdit,
}: {
  rows: number;
  cols: number;
  pageSlots: ReadonlyArray<{ id: string; filled: boolean } | null>;
  /** What the page will look like: saved pictures plus the draft. */
  preview: readonly PlacedPageArt[];
  saved: readonly PlacedPageArt[];
  editingId: string | null;
  rect: PageArtRect;
  imageFor: (source: PageArtSource) => string | null | undefined;
  onRect: (rect: PageArtRect) => void;
  onEdit: (placed: PlacedPageArt) => void;
}) {
  const corner = useRef<number | null>(null);
  const drag = useRef<{ from: number; moved: boolean } | null>(null);
  const end = () => {
    drag.current = null;
  };
  return (
    <div
      data-no-swipe
      role="group"
      aria-label="Pockets on this page"
      className="relative mx-auto grid touch-none select-none"
      style={{
        gap: 3,
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        aspectRatio: `${cols * 63} / ${rows * 88}`,
        maxHeight: '38dvh',
        maxWidth: '100%',
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const at = cellAt(event.clientX, event.clientY);
        if (at === null || (at === drag.current.from && !drag.current.moved)) return;
        drag.current.moved = true;
        corner.current = null;
        onRect(rectFromCorners(drag.current.from, at, cols));
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <PageArtLayer placed={preview} imageFor={imageFor} />
      {pageSlots.map((slot, index) => {
        const selected = contains(rect, index, cols);
        return (
          <button
            // oxlint-disable-next-line react-doctor/no-array-index-as-key -- a cell is its position on the page
            key={index}
            type="button"
            data-art-cell={index}
            aria-label={`Pocket ${String.fromCharCode(65 + Math.floor(index / cols))}${(index % cols) + 1}${slot?.filled ? ', has a card' : ''}`}
            aria-pressed={selected}
            disabled={!slot && !selected}
            onPointerDown={(event) => {
              // Touch captures the pointer on the first cell; release it so moves report the cell under the finger.
              event.currentTarget.releasePointerCapture?.(event.pointerId);
              drag.current = { from: index, moved: false };
            }}
            onClick={() => {
              if (drag.current?.moved) return;
              const hit = saved.find((p) => p.art.id !== editingId && contains(p, index, cols));
              if (hit && corner.current === null) {
                onEdit(hit);
                return;
              }
              onRect(rectFromCorners(corner.current ?? index, index, cols));
              corner.current = corner.current === null ? index : null;
            }}
            className={`relative min-h-0 min-w-0 border ${selected ? 'border-primary ring-primary ring-2' : 'border-border/60'} ${slot?.filled ? 'bg-foreground/15' : 'bg-transparent'} disabled:opacity-30`}
            style={{ borderRadius: TRADING_CARD_CORNER_RADIUS }}
          />
        );
      })}
    </div>
  );
}

/** Where the picture comes from: a catalogue card, a Pokémon's artwork or the owner's own image. */
export function PictureSource({
  tab,
  onTab,
  onPick,
  onFile,
  softPrint,
}: {
  tab: PageArtTab;
  onTab: (tab: PageArtTab) => void;
  onPick: (source: PageArtSource) => void;
  onFile: (file: File | undefined) => void;
  /** A catalogue picture over a large area: say it prints soft. */
  softPrint: boolean;
}) {
  const [search, setSearch] = useState('');
  const cardSearch = useCardSearch(search, tab === 'card');
  const cards =
    tab === 'card' && search.trim().length >= 2
      ? cardSearch.cards.slice(0, 24).flatMap((card) => {
          const key = pageArtCardImageKey(card.image);
          return key ? [{ card, key, thumb: toCardThumbnailSrc(card.image)?.src ?? card.image }] : [];
        })
      : [];
  const needle = search.trim().toLowerCase();
  const pokemon =
    tab === 'pokemon' && needle
      ? POKEMON_CATALOG.filter((p) => p.name.toLowerCase().includes(needle) || String(p.id) === needle).slice(0, 24)
      : [];
  return pageArtGroup(
    'Picture',
    <>
      <SegmentedControl
        label="Picture source"
        value={tab}
        options={[
          { value: 'card', label: 'Card' },
          { value: 'pokemon', label: 'Pokémon' },
          { value: 'upload', label: 'Your image' },
        ]}
        onChange={(value) => {
          onTab(value);
          setSearch('');
        }}
      />
      {tab === 'upload' ? (
        <label className="border-border hover:bg-muted/60 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed px-3 text-center text-sm font-semibold">
          <ImagePlus className="h-4 w-4 shrink-0" aria-hidden />
          Choose an image (PNG, JPEG or WebP, under 5 MB)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => {
              onFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
      ) : (
        <Input
          aria-label={tab === 'card' ? 'Find a card' : 'Find a Pokémon'}
          placeholder={tab === 'card' ? 'Card name, set or number' : 'Pokémon name or number'}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      {tab === 'card' && search.trim().length >= 2 && !cards.length && (
        <p role="status" className="text-muted-foreground text-sm">
          {cardSearch.loading ? 'Searching…' : 'No cards found.'}
        </p>
      )}
      {(cards.length > 0 || pokemon.length > 0) && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {cards.map(({ card, key, thumb }) => (
            <button
              key={card.id}
              type="button"
              aria-label={`Use ${card.name} ${card.localId} from ${card.set.name}`}
              onClick={() => onPick({ kind: 'card', cardId: card.id, image: key })}
              className="holo-tile overflow-hidden rounded-lg"
            >
              {/* oxlint-disable-next-line nextjs/no-img-element -- a small search result thumbnail from our asset host */}
              <img src={thumb} alt="" loading="lazy" className="aspect-[63/88] w-full object-cover" />
            </button>
          ))}
          {pokemon.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-label={`Use ${formatPokemonDisplayName(p.name)} artwork`}
              onClick={() => onPick({ kind: 'pokemon', pokemonId: p.id })}
              className="holo-tile flex flex-col items-center gap-1 overflow-hidden rounded-lg p-1 text-xs"
            >
              {/* oxlint-disable-next-line nextjs/no-img-element -- grid-sized Pokémon artwork through our image proxy */}
              <img
                src={getOfficialArtworkUrl(p.id)}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-contain"
              />
              <span className="w-full truncate">{formatPokemonDisplayName(p.name)}</span>
            </button>
          ))}
        </div>
      )}
      {softPrint && (
        <p className="text-muted-foreground text-xs">
          Catalogue pictures are small, so printed across a large area they come out soft. Your own image prints
          sharper.
        </p>
      )}
    </>,
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex min-h-9 items-center gap-3 text-sm">
      <span className="w-20 shrink-0">{label}</span>
      <input
        type="range"
        className="accent-primary min-w-0 flex-1"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

/** Fill or fit, zoom and position, the same controls as Binder Studio's artwork. */
export function FramingControls({ frame, onChange }: { frame: ArtworkFrame; onChange: (frame: ArtworkFrame) => void }) {
  return pageArtGroup(
    'Framing',
    <>
      <SegmentedControl
        label="Framing"
        value={frame.fit}
        options={[
          { value: 'fill', label: 'Fill and crop' },
          { value: 'fit', label: 'Fit whole picture' },
        ]}
        onChange={(fit) => onChange({ ...frame, fit })}
      />
      <Range
        label="Zoom"
        value={frame.zoom}
        min={0.25}
        max={4}
        step={0.05}
        onChange={(zoom) => onChange({ ...frame, zoom })}
      />
      <Range
        label="Left–right"
        value={frame.x}
        min={-1}
        max={1}
        step={0.01}
        onChange={(x) => onChange({ ...frame, x })}
      />
      <Range label="Up–down" value={frame.y} min={-1} max={1} step={0.01} onChange={(y) => onChange({ ...frame, y })} />
    </>,
  );
}

const GAP_KEY = 'holofolder:page-art-gap-mm';
function readGap() {
  try {
    const value = Number(window.localStorage.getItem(GAP_KEY));
    return Number.isFinite(value) && value >= 0 && value <= 20 ? value : 0;
  } catch {
    return 0;
  }
}

/** Paper, the measured gap between pockets and whether to skip pockets that hold a card. */
export function PrintOptions({
  slices,
  imageFor,
}: {
  slices: (options: { gap: number; skipFilled: boolean }) => PageArtSlice[];
  imageFor: (source: PageArtSource) => string | null | undefined;
}) {
  const [job, setJob] = useState<(PageArtPrintJob & { id: number }) | null>(null);
  const gapId = useId();
  const [paper, setPaper] = useState<PaperSize>(() =>
    defaultPaper(typeof navigator === 'undefined' ? undefined : navigator.language),
  );
  const [gap, setGap] = useState(readGap);
  const [skipFilled, setSkipFilled] = useState(true);
  return pageArtGroup(
    'Print',
    <>
      <div className="grid grid-cols-2 gap-1.5">
        {(['a4', 'letter'] as const).map((size) => (
          <OptionRow key={size} title={PAPER[size].label} selected={paper === size} onClick={() => setPaper(size)} />
        ))}
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <label htmlFor={gapId} className="text-sm font-medium">
          Gap between pockets (mm)
        </label>
        <Input
          id={gapId}
          type="number"
          inputMode="decimal"
          min={0}
          max={20}
          step={0.5}
          className="w-24"
          value={gap}
          onChange={(event) => setGap(Math.min(20, Math.max(0, Number(event.target.value) || 0)))}
        />
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <p className="text-sm font-medium">Skip pockets that hold a card</p>
        <Switch checked={skipFilled} onCheckedChange={setSkipFilled} aria-label="Skip pockets that hold a card" />
      </div>
      <p className="text-muted-foreground text-xs">
        Measure the gap from the edge of one sleeved card to the edge of the next in your binder. The print leaves that
        strip out, so the picture lines up across the pockets. Print at 100% (“Actual size”).
      </p>
      <Button
        variant="outline"
        className="h-11 w-full rounded-2xl"
        onClick={() => {
          try {
            window.localStorage.setItem(GAP_KEY, String(gap));
          } catch {
            // Private mode: the gap just isn't remembered.
          }
          const next = slices({ gap, skipFilled });
          if (next.length) setJob({ id: (job?.id ?? 0) + 1, slices: next, paper });
        }}
      >
        Print this page’s art
      </Button>
      {job && <PageArtPrint key={job.id} job={job} imageFor={imageFor} onDone={() => setJob(null)} />}
    </>,
  );
}
