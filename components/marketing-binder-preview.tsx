'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { binderFill, binderTurnPage, defaultBinderDesign, type BinderPart, type BinderView } from '@/lib/binder-design';
import { FEATURED_CARDS, getFeaturedCardImageUrl } from '@/lib/featured-cards';
import { BinderPresetPicker } from '@/components/binder-preset-picker';
import { applyBinderDesignPreset } from '@/lib/binder-design-presets';
import styles from '@/components/marketing-binder-preview.module.css';

const Viewport = dynamic(() => import('@/components/binder-designer/viewport'), {
  ssr: false,
  loading: () => <div className={styles.loading}>Opening the binder…</div>,
});
const initialDesign = {
  ...defaultBinderDesign(),
  rows: 3,
  cols: 3,
  pageCount: Math.ceil(FEATURED_CARDS.length / 9),
  stats: 'off' as const,
};
initialDesign.surfaces.cover.words = 'Favourites';
initialDesign.surfaces.spine.words = 'Holo Folder';
const cards = FEATURED_CARDS.map((card) => ({ id: card.id, name: card.name, image: getFeaturedCardImageUrl(card) }));
const stats = {
  placed: cards.length,
  wanted: 0,
  capacity: initialDesign.pageCount * 9,
  sample: true,
  filled: binderFill(
    cards.map((_, i) => i),
    initialDesign.pageCount * 9,
  ),
};
const artwork = {};
const views: { label: string; view: BinderView }[] = [
  { label: 'Cover', view: 'front' },
  { label: 'Inside', view: 'inside' },
  { label: 'Spine', view: 'spine' },
];

export function MarketingBinderPreview() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [design, setDesign] = useState(() => applyBinderDesignPreset(initialDesign, 'archive'));
  const [preset, setPreset] = useState('archive');
  const [view, setView] = useState<BinderView>('front');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  const select = (part: BinderPart) =>
    setView(part === 'pages' || part === 'lining' ? 'inside' : part === 'spine' ? 'spine' : 'front');
  return (
    <div ref={host} className={styles.preview} role="group" aria-label="Interactive Binder Studio preview">
      {ready ? (
        <Viewport
          compact
          design={design}
          cards={cards}
          stats={stats}
          page={page}
          artwork={artwork}
          view={view}
          onSelect={select}
          onPageTurn={(direction) => setPage((current) => binderTurnPage(current, design.pageCount, direction))}
        />
      ) : (
        <div className={styles.loading}>A closer look at your binder.</div>
      )}
      <div className={styles.toolbar}>
        <div>
          {views.map((item) => (
            <button key={item.view} type="button" aria-pressed={view === item.view} onClick={() => setView(item.view)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <details className={styles.presets}>
        <summary>Presets</summary>
        <BinderPresetPicker
          active={preset}
          onSelect={(id) => {
            setDesign((current) => applyBinderDesignPreset(current, id));
            setPreset(id);
            setView('front');
          }}
        />
      </details>
      {view === 'inside' && (
        <div className={styles.pages}>
          <button
            type="button"
            aria-label="Previous binder spread"
            disabled={page === 1}
            onClick={() => setPage((current) => binderTurnPage(current, design.pageCount, -1))}
          >
            ←
          </button>
          <span>Page {page}</span>
          <button
            type="button"
            aria-label="Next binder spread"
            disabled={binderTurnPage(page, design.pageCount, 1) === page}
            onClick={() => setPage((current) => binderTurnPage(current, design.pageCount, 1))}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
