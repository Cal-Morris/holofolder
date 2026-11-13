'use client';

import { X } from 'lucide-react';
import { OverlayDialog } from '@/components/ui/overlay-dialog';
import type { CardSearchLanguage } from '@/lib/card-languages';
import { CARD_PICKER_SORTS, normalizeCardPickerSort, type CardPickerSort } from '@/lib/card-selector-sort';
import { CARD_PICKER_LANGUAGES, CARD_PICKER_VARIANTS, type CardPickerVariantChoice } from '@/lib/card-picker-filters';
import { Select } from '@/components/ui/select';

interface CardPickerFiltersSheetProps {
  sort: CardPickerSort;
  onSortChange: (sort: CardPickerSort) => void;
  language: CardSearchLanguage;
  onLanguageChange: (language: CardSearchLanguage) => void;
  /** Card search only: offer "Any", every printing in its own language. */
  allowAnyLanguage?: boolean;
  /** Binder slots only: limit results to cards printed in the binder's languages. Undefined hides the toggle. */
  binderLanguagesOnly?: boolean;
  onBinderLanguagesOnlyChange?: (only: boolean) => void;
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
  /** Cards the filters leave, or null before there are any results to filter (no search yet). */
  resultCount: number | null;
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
  // Set and rarity options come from the loaded results, so hide a picker with nothing to choose.
  const showSets = props.sets.length > 1 || Boolean(props.set);
  const showRarities = props.rarities.length > 1 || Boolean(props.rarity);

  return (
    <OverlayDialog
      onClose={onClose}
      aria-label="Filters and sort"
      className="flex flex-col px-4 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)]"
    >
      <div data-sheet-grabber className="-mx-4 -mt-3 shrink-0 px-4 pt-3">
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
            {props.language === 'any'
              ? 'Every printing, saved and priced in the language it was printed in.'
              : 'Prices follow this language; card art stays on the English print.'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(props.allowAnyLanguage
              ? [{ id: 'any' as const, label: 'Any language', shortLabel: 'Any' }, ...CARD_PICKER_LANGUAGES]
              : CARD_PICKER_LANGUAGES
            ).map((language) => (
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
          {props.binderLanguagesOnly !== undefined && (
            <button
              type="button"
              aria-pressed={props.binderLanguagesOnly}
              onClick={() => props.onBinderLanguagesOnlyChange?.(!props.binderLanguagesOnly)}
              className={chipClass(props.binderLanguagesOnly)}
            >
              Only this binder’s languages
            </button>
          )}
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

        {(showSets || showRarities) && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-2">
            {showSets && (
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
            )}
            {showRarities && (
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
            )}
          </div>
        )}
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
          {props.resultCount === null
            ? 'Done'
            : `Show ${props.resultCount} ${props.resultCount === 1 ? 'card' : 'cards'}`}
        </button>
      </div>
    </OverlayDialog>
  );
}
