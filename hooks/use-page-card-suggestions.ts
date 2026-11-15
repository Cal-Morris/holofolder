'use client';

import { useEffect, useState } from 'react';
import type { SuggestionSeedSet } from '@/lib/page-card-suggestions';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

export type PageSuggestionSeeds = {
  page: SuggestionSeedSet | null;
  binder: SuggestionSeedSet;
  binderCardIds: string[];
};
export type SuggestionScope = 'page' | 'binder';

const STORAGE_KEY = 'holofolder_card_picker_suggest';

function readEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Cards similar to the ones on the tapped pocket's page (or the whole binder), for the free-pocket picker. Off until
 * the user turns it on (remembered on this device). Starts on the page, or the binder when the page is empty. Cards
 * already in the binder are left out. Online only.
 */
export function usePageCardSuggestions(seeds: PageSuggestionSeeds | undefined, language: string) {
  const [enabled, setEnabled] = useState(readEnabled);
  const [chosenScope, setScope] = useState<SuggestionScope>('page');
  const [result, setResult] = useState<{ key: string; cards: SearchCardResult[] } | null>(null);
  const scope: SuggestionScope = seeds?.page ? chosenScope : 'binder';
  const from = seeds && (scope === 'page' ? seeds.page : seeds.binder);
  const key =
    from && enabled ? `like=${from.cardIds.join(',')}&pokemon=${from.pokemonIds.join(',')}&language=${language}` : '';

  // oxlint-disable-next-line react-doctor/no-fetch-in-effect -- one fetch per page key with an AbortController; aborted results are dropped.
  useEffect(() => {
    if (!key || !seeds) return;
    const controller = new AbortController();
    const inBinder = new Set(seeds.binderCardIds);
    fetch(`/app/api/tcg-card-search?${key}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { cards: [] }))
      .then((payload: { cards?: SearchCardResult[] }) =>
        setResult({ key, cards: (payload.cards ?? []).filter((card) => !inBinder.has(card.id)) }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, cards: [] });
      });
    return () => controller.abort();
  }, [key, seeds]);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Storage blocked: the choice still applies to this sheet.
    }
  };
  const current = key && result?.key === key ? result.cards : null;
  return {
    available: Boolean(seeds),
    enabled,
    toggle,
    scope,
    setScope,
    /** False when the page is empty, so only the whole binder can be suggested from. */
    canUsePage: Boolean(seeds?.page),
    loading: Boolean(key) && !current,
    cards: current ?? [],
  };
}
