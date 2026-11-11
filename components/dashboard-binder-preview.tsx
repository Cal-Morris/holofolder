'use client';

import { adaptLegacyDisplaySlots, displaySlotLabel, type BinderDisplaySlot } from '@/lib/binder-display-model';
import { POKEMON_CATALOG } from '@/lib/pokemon-catalog';
import { toCardImageProxySrc } from '@/lib/card-image-url';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  binderFill,
  isCardArtworkUrl,
  binderSpread,
  binderTurnPage,
  type BinderDesign,
  type BinderPart,
  type BinderView,
} from '@/lib/binder-design';
import { getBinderDisplayCard, type BinderCardDisplay } from '@/lib/selected-slot-card-display';
import type { CollectedPokemon } from '@/lib/domain/cards';
import { getPokemonSummary, type PokemonSummary } from '@/lib/pokemon-catalog';
import styles from '@/components/dashboard-binder-preview.module.css';

const Viewport = dynamic(() => import('@/components/binder-designer/viewport'), {
  ssr: false,
  loading: () => <div className={styles.loading}>Opening your binder…</div>,
});
const views: { label: string; view: BinderView }[] = [
  { label: 'Cover', view: 'front' },
  { label: 'Inside', view: 'inside' },
  { label: 'Spine', view: 'spine' },
];

export default function DashboardBinderPreview({
  appearance: design,
  artwork,
  loading,
  collection,
  cardDisplay,
  enabled,
  page,
  onPageChange,
  onSelectPokemon,
  displaySlots,
  onSelectSlot,
}: {
  displaySlots?: (BinderDisplaySlot | null)[];
  onSelectSlot?: (id: string) => void;
  appearance: BinderDesign;
  artwork: Record<string, string>;
  loading: boolean;
  collection: CollectedPokemon[];
  cardDisplay: BinderCardDisplay;
  enabled: boolean;
  page: number;
  onPageChange: (page: number) => void;
  onSelectPokemon: (pokemon: PokemonSummary) => void;
}) {
  const [view, setView] = useState<BinderView>('inside');
  const slots = useMemo(
    () =>
      displaySlots ??
      adaptLegacyDisplaySlots('legacy', POKEMON_CATALOG, (id) => collection.find((item) => item.pokemon_id === id)),
    [displaySlots, collection],
  );
  const cards = useMemo(
    () =>
      slots.flatMap((slot, position) => {
        if (!slot) return [];
        const legacy = slot.legacyItem;
        const card = legacy ? getBinderDisplayCard(legacy, cardDisplay) : null;
        const image = toCardImageProxySrc(slot.legacyPokemonId ? card?.card_image : slot.card?.image) ?? '';
        if (slot.legacyPokemonId && !card?.card_id) return [];
        return [
          {
            id: slot.id,
            name: slot.legacyPokemonId ? card?.card_name || legacy?.pokemon_name || '' : displaySlotLabel(slot),
            image: isCardArtworkUrl(image) ? image : '',
            slot: position,
            ...(!slot.legacyPokemonId
              ? {
                  presentation: slot.item
                    ? ('owned' as const)
                    : slot.target
                      ? ('target' as const)
                      : ('spacer' as const),
                }
              : {}),
          },
        ];
      }),
    [slots, cardDisplay],
  );
  const occupied = slots.filter(
    (slot) => slot?.item || (slot?.legacyItem && ['collected', 'finalized'].includes(slot.legacyItem.status)),
  );
  const stats = useMemo(() => {
    const capacity = displaySlots ? displaySlots.filter(Boolean).length : design.pageCount * design.rows * design.cols;
    return {
      placed: occupied.length,
      wanted: slots.reduce(
        (count, slot) => count + (slot?.wantedCards.length || (slot?.legacyItem?.status === 'wishlisted' ? 1 : 0)),
        0,
      ),
      capacity,
      sample: false,
      filled: binderFill(
        slots.flatMap((slot, index) =>
          slot?.item || (slot?.legacyItem && ['collected', 'finalized'].includes(slot.legacyItem.status))
            ? [index]
            : [],
        ),
        capacity,
      ),
    };
  }, [occupied.length, slots, displaySlots, design.pageCount, design.rows, design.cols]);
  const selectSlot = (position: number) => {
    const slot = slots[position];
    if (!slot) return;
    if (displaySlots) onSelectSlot?.(slot.id);
    else if (slot.legacyPokemonId) {
      const pokemon = getPokemonSummary(slot.legacyPokemonId);
      if (pokemon) onSelectPokemon(pokemon);
    }
  };
  const spread = binderSpread(page, design.pageCount);
  const visibleCards = cards.filter((card) => {
    const face = Math.floor(card.slot / (design.rows * design.cols)) + 1;
    return face === spread.left || face === spread.right;
  });
  const select = (part: BinderPart) =>
    setView(
      part === 'pages' || part === 'lining'
        ? 'inside'
        : part === 'spine'
          ? 'spine'
          : part === 'back'
            ? 'back'
            : 'front',
    );

  return (
    <section
      className={styles.preview}
      aria-label={displaySlots ? 'Your 3D slot binder' : 'Your 3D National Dex binder'}
      data-binder-name={design.name}
    >
      <div className={styles.heading}>
        <div>
          <p>
            {displaySlots ? 'Ordered slots' : 'National Dex'} / {occupied.length} cards placed
          </p>
          <h2>{design.name}</h2>
        </div>
        {enabled && <Link href="/studio">Customize in Studio ↗</Link>}
      </div>
      {loading ? (
        <div className={styles.loading}>Loading your saved appearance…</div>
      ) : (
        <Viewport
          compact
          design={design}
          cards={cards}
          stats={stats}
          page={page}
          artwork={artwork}
          view={view}
          onSelect={select}
          onPageTurn={(direction) => onPageChange(binderTurnPage(page, design.pageCount, direction))}
          onSlotSelect={selectSlot}
        />
      )}
      <div className={styles.toolbar} role="group" aria-label="3D binder views">
        {views.map((item) => (
          <button key={item.view} type="button" aria-pressed={view === item.view} onClick={() => setView(item.view)}>
            {item.label}
          </button>
        ))}
      </div>
      {view === 'inside' && (
        <div className={styles.pages}>
          <button
            type="button"
            aria-label="Previous 3D binder spread"
            disabled={binderTurnPage(page, design.pageCount, -1) === page}
            onClick={() => onPageChange(binderTurnPage(page, design.pageCount, -1))}
          >
            ←
          </button>
          <span aria-live="polite">
            {spread.left > 0 ? `${spread.left} / ${spread.right || 'End'}` : 'Inside cover / 1'}
            <small>{design.pageCount} pages</small>
          </span>
          <button
            type="button"
            aria-label="Next 3D binder spread"
            disabled={binderTurnPage(page, design.pageCount, 1) === page}
            onClick={() => onPageChange(binderTurnPage(page, design.pageCount, 1))}
          >
            →
          </button>
        </div>
      )}
      {view === 'inside' && (
        <div className="sr-only" aria-live="polite">
          <ul aria-label="Cards on this spread">
            {visibleCards.map((card) => (
              <li key={card.id}>
                <button type="button" onClick={() => selectSlot(card.slot)}>
                  {card.name}, slot {card.slot + 1}
                </button>
              </li>
            ))}
          </ul>
          {!visibleCards.length && <p>No placed cards on this spread</p>}
        </div>
      )}
    </section>
  );
}
