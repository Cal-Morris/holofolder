'use client';

import CardImage from '@/components/card-image';
import { CARD_PICKER_LANGUAGES } from '@/lib/card-picker-filters';
import type { CardLanguage } from '@/lib/domain/cards';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

/** Shared catalog picker content; never selects ownership, grading or a destination. */
export default function SlotCatalogSearch({
  query,
  language,
  cards,
  loading,
  offline,
  disabled,
  onQuery,
  onLanguage,
  onSelect,
}: {
  query: string;
  language: CardLanguage;
  cards: readonly SearchCardResult[];
  loading: boolean;
  offline: boolean;
  disabled?: boolean;
  onQuery: (query: string) => void;
  onLanguage: (language: CardLanguage) => void;
  onSelect: (card: SearchCardResult) => void;
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        Catalog language
        <select
          aria-label="Catalog language"
          value={language}
          onChange={(e) => onLanguage(e.target.value as CardLanguage)}
          className="border-border bg-background ml-2 min-h-10 max-w-full rounded-xl border px-2 text-base"
        >
          {CARD_PICKER_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Search catalog
        <input
          aria-label="Search slot catalog"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="border-border bg-background mt-1 min-h-11 w-full rounded-xl border px-3 text-base"
        />
      </label>
      {offline && (
        <p role="status" className="text-muted-foreground text-sm">
          Searching cached cards on this device only. Uncached catalog coverage is unavailable offline.
        </p>
      )}
      {loading && <p role="status">Searching…</p>}
      {!loading && query.length >= 2 && !cards.length && <p>No matching cached or available catalog cards.</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {cards.map((c) => (
          <button
            type="button"
            className="border-border min-h-10 rounded-xl border px-3 py-2 text-left text-sm [overflow-wrap:anywhere] break-words active:scale-[0.98] disabled:opacity-50"
            key={`${c.id}:${c.language ?? 'unknown'}`}
            disabled={disabled}
            onClick={() => onSelect(c)}
          >
            {c.image && (
              <span className="trading-card bg-muted relative mx-auto mb-2 block w-full max-w-28 overflow-hidden rounded-lg">
                <CardImage src={c.image} alt={c.name} fill sizes="112px" className="object-contain" />
              </span>
            )}
            <span className="block font-medium">
              {c.name} · {c.set.name} · {c.localId} · {c.language ?? 'Unknown language'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
