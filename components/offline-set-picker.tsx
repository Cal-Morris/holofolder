'use client';

import { useState } from 'react';
import CardShowPrep from '@/components/card-show-prep';
import type { TCGSetSummary } from '@/lib/tcg-set-slots';

/** Find sets by name or code and save them for offline use (Settings → Offline & app). */
export function OfflineSetPicker({ isOnline }: { isOnline: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TCGSetSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      <CardShowPrep embedded candidateSets={results} />
    </>
  );
}
