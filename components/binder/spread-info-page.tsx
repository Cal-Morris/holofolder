'use client';

import type { CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';
import { GENERATIONS, type CollectionViewFilter } from '@/components/binder/binder-app-model';
import type { BinderSettings } from '@/hooks/use-settings';
import type { PokemonEntry } from '@/lib/pokemon-catalog';
import type { BinderColorTheme } from '@/lib/binder-colors';
import styles from './spread-info-page.module.css';

export interface SpreadInfoPageContext {
  native?: { name?: string; slotCount: number; valueLabel?: string };
  activeCollectionFilterOption: { id: CollectionViewFilter; label: string; mobileLabel: string; description: string };
  collectionStats: { collected: number; total: number; percentage: number };
  neededCount: number;
  /** Public shares with prices on: the summed pocket prices (the native analytics value isn't mounted there). */
  shareValueLabel?: string;
  canEditBinder: boolean;
  filteredPokemonList: PokemonEntry[];
  filteredTotalLabel: string;
  getBinderThemeForPage: (pageNumber?: number | null | undefined) => BinderColorTheme;
  hasTrackedCards: boolean;
  selectedGen: number;
  settings: BinderSettings;
  totalBinderPages: number;
}

export function renderSpreadInfoPageView(ctx: SpreadInfoPageContext, side: 'left' | 'right') {
  const {
    activeCollectionFilterOption,
    collectionStats,
    neededCount,
    canEditBinder,
    filteredPokemonList,
    filteredTotalLabel,
    getBinderThemeForPage,
    hasTrackedCards,
    selectedGen,
    settings,
    totalBinderPages,
  } = ctx;
  const pageTheme = getBinderThemeForPage(0);
  const valueLabel = ctx.native
    ? (ctx.native.valueLabel ?? ctx.shareValueLabel)
    : hasTrackedCards
      ? filteredTotalLabel
      : undefined;

  return (
    <section
      key={`spread-info-${side}`}
      aria-label="Inside cover"
      className={styles.cover}
      style={{ background: pageTheme.background, borderColor: pageTheme.border, boxShadow: pageTheme.shadow }}
    >
      <div className={styles.paper}>
        <div className={styles.content}>
          <header className={styles.header}>
            <div className={styles.brand}>
              <span className={styles.emblem} aria-hidden="true">
                <Sparkles />
              </span>
              Holo Folder<span className={styles.edition}>Inside cover</span>
            </div>
            <h2>
              Your collection,
              <br />
              beautifully kept.
            </h2>
            <p>
              {ctx.native
                ? (ctx.native.name ?? 'Binder')
                : selectedGen === 0
                  ? 'National Dex'
                  : GENERATIONS[selectedGen].name}
              <span className={styles.separator}>/</span>
              {settings.binderRows} × {settings.binderCols} pockets
            </p>
          </header>

          <div
            className={styles.progress}
            role="progressbar"
            aria-label="Collection completion"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={collectionStats.percentage}
            aria-valuetext={`${collectionStats.collected} of ${collectionStats.total} ${ctx.native ? 'slots' : 'Pokémon'} collected`}
          >
            <div className={styles.orbit} aria-hidden="true" />
            <div
              className={styles.ring}
              style={{ '--completion': `${collectionStats.percentage}%` } as CSSProperties}
              aria-hidden="true"
            />
            <div className={styles.progressLabel} aria-hidden="true">
              <strong>
                {collectionStats.percentage}
                <span>%</span>
              </strong>
              <span>complete</span>
            </div>
          </div>

          <dl className={styles.stats}>
            <div>
              <dt>Collected</dt>
              <dd>
                {collectionStats.collected} <span>/ {collectionStats.total}</span>
              </dd>
            </div>
            <div>
              <dt>Needed</dt>
              <dd>{neededCount}</dd>
            </div>
            {valueLabel && (
              <div>
                <dt>{ctx.native ? 'Value' : 'Tracked value'}</dt>
                <dd className={styles.valueAmount}>{valueLabel}</dd>
              </div>
            )}
          </dl>

          <footer className={styles.footer}>
            <p>
              <span>{activeCollectionFilterOption.label}</span>
              <span>{totalBinderPages} pages</span>
              <span>{ctx.native ? `${ctx.native.slotCount} slots` : `${filteredPokemonList.length} Pokémon`}</span>
              {!canEditBinder && <span>Read-only</span>}
            </p>
            {!canEditBinder && !ctx.native && <p className={styles.hint}>A collection to explore. Shared read-only.</p>}
          </footer>
        </div>
      </div>
    </section>
  );
}
