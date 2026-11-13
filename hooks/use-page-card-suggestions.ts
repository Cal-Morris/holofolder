'use client';

import { useEffect, useState } from 'react';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

export type PageSuggestionSeeds = { cardIds: string[]; pokemonIds: number[]; binderCardIds: string[] };

const STORAGE_KEY = 'holofolder_card_picker_suggest';

function readEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Cards similar to the ones on the tapped pocket's page, for the free-pocket picker. Off until the user turns it on
 * (remembered on this device). Cards already in the binder are left out. Online only.
 */
export function usePageCardSuggestions(seeds: PageSuggestionSeeds | undefined, language: string) {
  const [enabled, setEnabled] = useState(readEnabled);
  const [result, setResult] = useState<{ key: string; cards: SearchCardResult[] } | null>(null);
  const key =
    seeds && enabled
      ? `like=${seeds.cardIds.join(',')}&pokemon=${seeds.pokemonIds.join(',')}&language=${language}`
      : '';

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
  return { available: Boolean(seeds), enabled, toggle, loading: Boolean(key) && !current, cards: current ?? [] };
}
