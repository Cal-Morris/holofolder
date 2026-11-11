'use client';

import { useState } from 'react';
import ShowHunt from '@/components/show-hunt';
import type { HuntSourceItem } from '@/lib/show-hunt';

// Synthetic printings for the local-only scroll regression, not catalogue or price data.
const items: HuntSourceItem[] = Array.from({ length: 100 }, (_, index) => ({
  pokemon_id: index + 1,
  pokemon_name: `pokemon ${index + 1}`,
  wanted_cards: Array.from({ length: 5 }, (_, card) => ({
    card_id: `scroll-${index}-${card}`,
    card_name: `Fixture card ${index}-${card}`,
    card_set: 'Fixture set',
    card_language: 'en',
    added_at: '2026-01-01T00:00:00.000Z',
  })),
}));

export default function ShowHuntHarness() {
  const [picked, setPicked] = useState('');
  return (
    <main className="flex h-dvh flex-col pt-[var(--top-inset)] pb-[var(--safe-bottom)]">
      <output aria-label="Picked card">{picked}</output>
      <ShowHunt
        items={items}
        currency="GBP"
        pricingRegion="UK"
        isOnline
        onPickCard={(card) => setPicked(card.id)}
        onPickPokemon={() => {}}
      />
    </main>
  );
}
