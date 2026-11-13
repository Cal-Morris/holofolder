'use client';

import { useMemo, useState } from 'react';
import BinderOfflinePrep, { type BinderOfflineSource } from '@/components/binder-offline-prep';
import CardShowPrep from '@/components/card-show-prep';
import PictureScannerPrep from '@/components/picture-scanner-prep';
import { getSetIdFromCardId, type HuntSourceItem } from '@/lib/show-hunt';
import type { TCGSetSummary } from '@/lib/tcg-set-slots';

/** Runs inside Quick mode's existing overlay, including its focus trap and history entry. */
export default function ShowOfflinePrep({
  items,
  isOnline,
  binder,
}: {
  items: readonly HuntSourceItem[];
  isOnline: boolean;
  binder?: BinderOfflineSource;
}) {
  const wantedSets = useMemo(() => {
    const sets = new Map<string, TCGSetSummary>();
    for (const card of items.flatMap((item) => item.wanted_cards ?? [])) {
      const id = getSetIdFromCardId(card.card_id);
      sets.set(id, { id, name: card.card_set || id });
    }
    return [...sets.values()];
  }, [items]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[var(--dock-clearance)]">
      {binder && <BinderOfflinePrep {...binder} isOnline={isOnline} />}
      <PictureScannerPrep isOnline={isOnline} />
      <p className="text-muted-foreground mt-4 mb-3 text-sm">Optional extra sets</p>
      <OfflineSetPicker seedSets={wantedSets} isOnline={isOnline} />
    </div>
  );
}

const NO_SETS: readonly TCGSetSummary[] = [];

/** Find sets by name or code and save them for offline use (Quick mode's show prep and Settings). */
export function OfflineSetPicker({
  seedSets = NO_SETS,
  isOnline,
}: {
  seedSets?: readonly TCGSetSummary[];
  isOnline: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TCGSetSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(
    () => [...new Map([...seedSets, ...results].map((set) => [set.id, set])).values()],
    [seedSets, results],
  );
  const search = async () => {
    if (!navigator.onLine || !query.trim() || searching) return;
    setSearching(true);
    setError(null);
    try {
      const response = await fetch(`/app/api/tcg-set-slots?${new URLSearchParams({ query: query.trim() })}`);
      if (!response.ok) throw new Error("Couldn't search sets. Try again when connected.");
      const payload = await response.json();
      const sets = Array.isArray(payload.sets)
        ? payload.sets.filter((set: TCGSetSummary) => set && typeof set.id === 'string' && typeof set.name === 'string')
        : [];
      setResults((current) => [...new Map([...current, ...sets].map((set) => [set.id, set])).values()]);
      if (!sets.length) setError('No sets found. Try a set name or code.');
    } catch {
      setError("Couldn't search sets. Try again when connected.");
    } finally {
      setSearching(false);
    }
  };
  return (
    <>
      {/* oxlint-disable-next-line react-doctor/no-prevent-default -- client-only form that works on the device; there is no server action to post to */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
        className="flex gap-2"
      >
        <input
          type="search"
          aria-label="Find sets to save"
          placeholder="Set name or code"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="border-border bg-background h-10 min-w-0 flex-1 rounded-xl border px-3 text-base"
        />
        <button
          type="submit"
          disabled={!isOnline || searching || !query.trim()}
          className="bg-muted min-h-10 rounded-xl px-3 text-sm font-medium disabled:opacity-50"
        >
          {searching ? 'Finding…' : 'Find'}
        </button>
      </form>
      {error && (
        <p role="status" className="mt-2 text-xs">
          {error}
        </p>
      )}
      <CardShowPrep embedded candidateSets={candidates} />
    </>
  );
}
