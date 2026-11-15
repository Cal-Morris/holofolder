import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardsToAddAll,
  creationSummary,
  filterChosenCardMatches,
  FREE_PAGE_SIZES,
  pageSizeLabel,
  suggestedBinderName,
} from '@/lib/binder-creation-wizard';
import { printingPreset } from '@/lib/binder-creation-draft';
import type { BrowseCard } from '@/lib/pokemon-card-browse';

describe('binder creation wizard', () => {
  test('offers only page sizes every plan may save', () => {
    // The saved-layout rule (scripts/057) lets any owner use these without Premium.
    const free = new Set(['1x1', '2x2', '3x3', '3x4', '4x3', '4x4']);
    for (const size of FREE_PAGE_SIZES) assert.ok(free.has(`${size.rows}x${size.cols}`), `${size.rows}x${size.cols}`);
    assert.equal(pageSizeLabel({ rows: 3, cols: 4 }), '12 pockets, 3 by 4');
  });

  test('suggests a name only where the preset has an obvious one', () => {
    assert.equal(suggestedBinderName('national'), 'National Dex');
    assert.equal(suggestedBinderName('generation', { region: 'Johto' }), 'Johto');
    assert.equal(suggestedBinderName('set', { setName: 'Synthetic Set' }), 'Synthetic Set');
    assert.equal(suggestedBinderName('set'), '');
    assert.equal(suggestedBinderName('blank'), '');
    assert.equal(suggestedBinderName('species'), '');
  });

  test('summarises what the binder holds and how many pages it makes', () => {
    assert.equal(
      creationSummary('national', 1025, { rows: 4, cols: 4 }),
      'National Dex · 1,025 Pokémon · 65 pages of 16',
    );
    assert.equal(
      creationSummary('generation', 151, { rows: 3, cols: 3 }, { region: 'Kanto' }),
      'Kanto · 151 Pokémon · 17 pages of 9',
    );
    assert.equal(creationSummary('printings', 1, { rows: 2, cols: 2 }), '1 card · 1 page of 4');
    assert.equal(creationSummary('blank', 0, { rows: 3, cols: 4 }), 'Blank · 12 pockets a page');
    assert.equal(creationSummary('species', 3, null), '3 Pokémon · list');
  });
});

// Synthetic cards, not real catalogue data.
const synthetic = (id: string, set: string, releaseDate: string, extra: Partial<BrowseCard> = {}): BrowseCard => ({
  id,
  localId: id.split('-')[1],
  name: `Synthetic ${id}`,
  language: 'en',
  set: { id: set, name: `Synthetic ${set}`, releaseDate },
  ...extra,
});

describe('chosen cards filters and add all', () => {
  const newer = synthetic('syn2-1', 'syn2', '2020-01-01', { rarity: 'Illustration rare', variants: { holo: true } });
  const older = synthetic('syn1-2', 'syn1', '1999-01-01', { rarity: 'Common', variants: { normal: true } });
  const olderFirst = synthetic('syn1-1', 'syn1', '1999-01-01', { rarity: 'Common', variants: { holo: true } });

  test('narrows by set, rarity and variant', () => {
    const cards = [newer, older, olderFirst];
    assert.deepEqual(filterChosenCardMatches(cards, { variant: 'any' }), cards);
    assert.deepEqual(filterChosenCardMatches(cards, { variant: 'any', set: 'syn1' }), [older, olderFirst]);
    assert.deepEqual(filterChosenCardMatches(cards, { variant: 'any', rarity: 'Common' }), [older, olderFirst]);
    assert.deepEqual(filterChosenCardMatches(cards, { variant: 'holo' }), [newer, olderFirst]);
    assert.deepEqual(filterChosenCardMatches(cards, { variant: 'illustration_rare' }), [newer]);
  });

  test('adds oldest set first, skipping cards already chosen, and the result is a valid printing preset', () => {
    const added = cardsToAddAll([newer, older, olderFirst], [older]);
    assert.deepEqual(added, [olderFirst, newer]);
    assert.deepEqual(
      printingPreset(added).entries.map((e) => e.target),
      [
        { kind: 'card', cardId: 'syn1-1', language: 'en' },
        { kind: 'card', cardId: 'syn2-1', language: 'en' },
      ],
    );
    // The same card in another language is a different printing.
    assert.equal(cardsToAddAll([{ ...older, language: 'fr' }], [older]).length, 1);
    // Without a known language there is no exact printing to reserve.
    assert.equal(cardsToAddAll([{ ...older, language: undefined }], []).length, 0);
  });
});
