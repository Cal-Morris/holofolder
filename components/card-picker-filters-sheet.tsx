'use client';

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import type { CardLanguage } from '@/lib/domain/cards';
import { CARD_PICKER_SORTS, normalizeCardPickerSort, type CardPickerSort } from '@/lib/card-selector-sort';
import { CARD_PICKER_LANGUAGES, CARD_PICKER_VARIANTS, type CardPickerVariantChoice } from '@/lib/card-picker-filters';
import { Select } from '@/components/ui/select';

interface CardPickerFiltersSheetProps {
  sort: CardPickerSort;
  onSortChange: (sort: CardPickerSort) => void;
  language: CardLanguage;
  onLanguageChange: (language: CardLanguage) => void;
  variant: CardPickerVariantChoice;
  onVariantChange: (variant: CardPickerVariantChoice) => void;
  pokemon?: number;
  pokemonOptions: Array<{ id: number; name: string }>;
  onPokemonChange: (pokemon: number | undefined) => void;
  set?: string;
  sets: Array<{ id: string; name: string }>;
  onSetChange: (set: string | undefined) => void;
  rarity?: string;
  rarities: string[];
  onRarityChange: (rarity: string | undefined) => void;
  resultCount: number;
  onReset: () => void;
  onClose: () => void;
}

const selectClass = 'w-full';

function chipClass(selected: boolean) {
  return `flex h-9 shrink-0 items-center rounded-full border px-3 text-xs font-semibold transition-colors ${
    selected
      ? 'border-primary/45 bg-primary/12 text-primary'
      : 'border-border/55 bg-background/65 text-muted-foreground hover:text-foreground'
  }`;
}

/**
 * The card picker's filter and sort sheet: sort, card language, variant, Pokémon (any-card search), set and rarity in one place,
 * so the picker itself can open straight onto search and cards. Built on the shared overlay primitive
 * (Escape/back closes it, focus is trapped and returned).
 */
export default function CardPickerFiltersSheet(props: CardPickerFiltersSheetProps) {
  const { onClose } = props;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useOverlay(true, onClose, { containerRef: sheetRef });
  const swipe = useSwipeToDismiss(sheetRef, onClose);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div data-overlay-backdrop className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filters and sort"
        className="border-border/65 bg-card absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-[1.6rem] border-t px-4 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)] shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] outline-none sm:bottom-4 sm:rounded-[1.6rem] sm:border"
        onClick={(event) => event.stopPropagation()}
      >
        <div data-sheet-grabber className="-mx-4 -mt-3 shrink-0 px-4 pt-3" {...swipe}>
          <div aria-hidden="true" className="bg-muted-foreground/30 mx-auto mb-2 h-1.5 w-10 rounded-full" />
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Filters &amp; sort</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="text-muted-foreground hover:bg-muted/70 hover:text-foreground -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pb-2">
          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs font-semibold">Sort</span>
            <Select
              aria-label="Sort cards"
              className={selectClass}
              value={props.sort}
              onChange={(event) => props.onSortChange(normalizeCardPickerSort(event.target.value))}
            >
              {CARD_PICKER_SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>

          <fieldset className="space-y-1.5">
            <legend className="text-muted-foreground mb-1.5 text-xs font-semibold">Card language</legend>
            <p className="text-muted-foreground text-[11px]">
              Prices follow this language; card art stays on the English print.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CARD_PICKER_LANGUAGES.map((language) => (
                <button
                  key={language.id}
                  type="button"
                  aria-pressed={props.language === language.id}
                  aria-label={language.label}
                  onClick={() => props.onLanguageChange(language.id)}
                  className={chipClass(props.language === language.id)}
                >
                  {language.shortLabel}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-muted-foreground mb-1.5 text-xs font-semibold">Variant</legend>
            <div className="flex flex-wrap gap-1.5">
              {CARD_PICKER_VARIANTS.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  aria-pressed={props.variant === variant.id}
                  onClick={() => props.onVariantChange(variant.id)}
                  className={chipClass(props.variant === variant.id)}
                >
                  {variant.label}
                </button>
              ))}
            </div>
          </fieldset>

          {props.pokemonOptions.length > 1 && (
            <label className="block space-y-1.5">
              <span className="text-muted-foreground text-xs font-semibold">Pokémon</span>
              <Select
                aria-label="Pokémon"
                className={selectClass}
                value={props.pokemon ?? ''}
                onChange={(event) => props.onPokemonChange(event.target.value ? Number(event.target.value) : undefined)}
              >
                <option value="">All Pokémon</option>
                {props.pokemonOptions.map((pokemon) => (
                  <option key={pokemon.id} value={pokemon.id}>
                    {pokemon.name}
                  </option>
                ))}
              </Select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0 space-y-1.5">
              <span className="text-muted-foreground text-xs font-semibold">Set</span>
              <Select
                aria-label="Set"
                className={selectClass}
                value={props.set ?? ''}
                onChange={(event) => props.onSetChange(event.target.value || undefined)}
              >
                <option value="">All sets</option>
                {props.sets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block min-w-0 space-y-1.5">
              <span className="text-muted-foreground text-xs font-semibold">Rarity</span>
              <Select
                aria-label="Rarity"
                className={selectClass}
                value={props.rarity ?? ''}
                onChange={(event) => props.onRarityChange(event.target.value || undefined)}
              >
                <option value="">All rarities</option>
                {props.rarities.map((rarity) => (
                  <option key={rarity} value={rarity}>
                    {rarity}
                  </option>
                ))}
              </Select>
            </label>
          </div>
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
