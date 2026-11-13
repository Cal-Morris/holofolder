import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getActiveFilterChips,
  getPokemonFilterOptions,
  getCardPickerFinishChoices,
  ownedCopyFinishChoices,
  getRecordedFinish,
  getVariantFilter,
  matchesRarityChoice,
} from '../lib/card-picker-filters';

describe('card picker filters', () => {
  test('variant choices narrow printings and/or set the recorded finish', () => {
    assert.equal(getVariantFilter('reverse_holo'), 'reverse');
    assert.equal(getRecordedFinish('reverse_holo'), 'reverse_holo');
    assert.equal(getVariantFilter('first_edition'), 'firstEdition');
    assert.equal(getRecordedFinish('first_edition'), null);
    assert.equal(getVariantFilter('illustration_rare'), undefined);
    assert.equal(getRecordedFinish('illustration_rare'), 'illustration_rare');
    assert.equal(getVariantFilter('any'), undefined);
    assert.equal(getRecordedFinish('any'), null);
  });

  test('rarity finish choices narrow to that rarity', () => {
    const sir = { rarity: 'Special illustration rare' };
    const common = { rarity: 'Common' };
    assert.equal(matchesRarityChoice(sir, 'special_illustration_rare'), true);
    assert.equal(matchesRarityChoice(common, 'special_illustration_rare'), false);
    assert.equal(matchesRarityChoice(sir, 'illustration_rare'), false);
    assert.equal(matchesRarityChoice(common, 'reverse_holo'), true);
    assert.equal(matchesRarityChoice(common, 'any'), true);
  });

  test('only non-default filters become chips', () => {
    const base = {
      filters: {},
      language: 'en' as const,
      defaultLanguage: 'en' as const,
      variant: 'any' as const,
      sort: 'default' as const,
    };
    assert.deepEqual(
      getActiveFilterChips(base, () => undefined),
      [],
    );
    assert.deepEqual(
      getActiveFilterChips({ ...base, filters: { searchQuery: 'pika' } }, () => undefined),
      [],
    );
    const chips = getActiveFilterChips(
      { ...base, filters: { set: 'sv03.5', rarity: 'Common' }, language: 'ja', variant: 'holo', sort: 'price-desc' },
      (id) => (id === 'sv03.5' ? '151' : undefined),
    );
    assert.deepEqual(
      chips.map((chip) => chip.label),
      ['Price: high to low', 'Japanese', 'Holo', '151', 'Common'],
    );
    assert.deepEqual(
      getActiveFilterChips({ ...base, language: 'any' }, () => undefined).map((chip) => chip.label),
      ['Any language'],
    );
  });
});

describe('card picker Pokémon filter', () => {
  test('lists each named Pokémon in the results once, alphabetically', () => {
    // Synthetic results for "mew": Mew, Mewtwo, and a 151 set hit featuring Bulbasaur; 0 has no name.
    const names: Record<number, string> = { 151: 'Mew', 150: 'Mewtwo', 1: 'Bulbasaur' };
    assert.deepEqual(
      getPokemonFilterOptions(
        [{ dexIds: [151] }, { dexIds: [150, 151] }, { dexIds: [1] }, { dexIds: [0] }],
        (id) => names[id],
      ),
      [
        { id: 1, name: 'Bulbasaur' },
        { id: 151, name: 'Mew' },
        { id: 150, name: 'Mewtwo' },
      ],
    );
  });

  test('a chosen Pokémon becomes a chip', () => {
    const chips = getActiveFilterChips(
      { filters: { pokemon: 151 }, language: 'en', defaultLanguage: 'en', variant: 'any', sort: 'default' },
      () => undefined,
      (id) => (id === 151 ? 'Mew' : undefined),
    );
    assert.deepEqual(chips, [{ key: 'pokemon', label: 'Mew' }]);
  });
});

describe('card picker finish choices', () => {
  test('asks only when a printing has more than one standard finish', async () => {
    const { getCardPickerFinishChoices } = await import('../lib/card-picker-filters');
    assert.deepEqual(
      getCardPickerFinishChoices({ normal: true, reverse: true }, 'reverse_holo', 'any').map((choice) => choice.finish),
      ['normal', 'reverse_holo'],
    );
    assert.deepEqual(getCardPickerFinishChoices({ holo: true }, 'holo', 'any'), []);
    assert.deepEqual(getCardPickerFinishChoices({ holo: true, reverse: true }, 'illustration_rare', 'any'), []);
    assert.deepEqual(getCardPickerFinishChoices({ normal: true, reverse: true }, 'reverse_holo', 'normal'), []);
    assert.equal(
      getCardPickerFinishChoices({ normal: true, reverse: true }, 'reverse_holo', 'first_edition').length,
      2,
    );
  });
});

// Synthetic finish quotes: catalogue flags can omit a provider-confirmed reverse printing.
describe('provider-confirmed picker finishes', () => {
  const quotes = [
    { finish: 'normal' as const, variantKey: 'normal', gbpAmount: 1 },
    { finish: 'reverse_holo' as const, variantKey: 'reverse-holofoil', gbpAmount: 2 },
  ];

  test('fills missing catalogue finishes from explicit standard printing quotes', () => {
    assert.deepEqual(
      getCardPickerFinishChoices({ normal: true, reverse: false }, 'normal', 'any', quotes).map((c) => c.finish),
      ['normal', 'reverse_holo'],
    );
    assert.deepEqual(
      getCardPickerFinishChoices(undefined, 'normal', 'any', quotes).map((c) => c.finish),
      ['normal', 'reverse_holo'],
    );
    assert.deepEqual(
      getCardPickerFinishChoices({ holo: true }, 'holo', 'any', quotes.slice(1)).map((c) => c.finish),
      ['holo', 'reverse_holo'],
    );
  });

  test('does not treat first edition as a non-holo printing', () => {
    assert.deepEqual(getCardPickerFinishChoices({ holo: true, firstEdition: true }, 'holo', 'any'), []);
  });

  test('ignores special printing quotes and invalid or missing amounts', () => {
    for (const quote of [
      { ...quotes[1], variantKey: '1st-edition-reverse-holofoil' },
      ...[0, -1, NaN, Infinity, null].map((gbpAmount) => ({ ...quotes[1], gbpAmount })),
    ]) {
      assert.deepEqual(getCardPickerFinishChoices({ normal: true }, 'normal', 'any', [quote]), []);
    }
  });

  test('keeps explicit filters, special rarities and single-finish cards unchanged', () => {
    assert.deepEqual(getCardPickerFinishChoices({ normal: true }, 'normal', 'reverse_holo', quotes), []);
    assert.deepEqual(getCardPickerFinishChoices({ holo: true }, 'illustration_rare', 'any', quotes), []);
    assert.deepEqual(getCardPickerFinishChoices({ normal: true }, 'normal', 'any', quotes.slice(0, 1)), []);
  });
});

describe('card picker priced variants', () => {
  // Synthetic prices, including the screenshot's unpriced Holo regression.
  const choices = [
    { finish: 'normal' as const, label: 'Normal' },
    { finish: 'holo' as const, label: 'Holo' },
    { finish: 'reverse_holo' as const, label: 'Reverse' },
  ];

  test('suggests the highest priced available finish rather than an unpriced holo', async () => {
    const { getCardPickerSuggestedFinish } = await import('../lib/card-picker-filters');
    const result = getCardPickerSuggestedFinish(
      choices,
      (finish) => ({ normal: 3.54, holo: null, reverse_holo: 54.72 })[finish],
    );
    assert.equal(result, 'reverse_holo');
    assert.equal(
      getCardPickerSuggestedFinish(choices, (finish) => (finish === 'normal' ? 60 : 12)),
      'normal',
    );
  });

  test('ignores unusable amounts', async () => {
    const { getCardPickerSuggestedFinish } = await import('../lib/card-picker-filters');
    for (const missing of [null, undefined, 0, -1, NaN, Infinity]) {
      assert.equal(
        getCardPickerSuggestedFinish(choices, (finish) => (finish === 'normal' ? missing : finish === 'holo' ? 12 : 6)),
        'holo',
      );
    }
  });

  test('keeps catalog choices without a suggestion when all prices are missing', async () => {
    const { getCardPickerSuggestedFinish } = await import('../lib/card-picker-filters');
    const result = getCardPickerSuggestedFinish(choices, () => null);
    assert.equal(result, null);
  });

  test('only considers offered finishes and breaks price ties in catalog order', async () => {
    const { getCardPickerSuggestedFinish } = await import('../lib/card-picker-filters');
    assert.equal(
      getCardPickerSuggestedFinish(choices.slice(1), () => 4),
      'holo',
    );
    assert.equal(
      getCardPickerSuggestedFinish([], () => 100),
      null,
    );
  });
});

describe('owned copy finish choices', () => {
  test('lists the printing finishes unless the pocket pins one', () => {
    const card = { rarity: 'Common', variants: { normal: true, reverse: true } };
    assert.deepEqual(
      ownedCopyFinishChoices(card, undefined).map((c) => c.finish),
      ['normal', 'reverse_holo'],
    );
    assert.deepEqual(ownedCopyFinishChoices(card, 'normal'), []);
    assert.deepEqual(ownedCopyFinishChoices(undefined, undefined), []);
    assert.deepEqual(ownedCopyFinishChoices({ rarity: 'Common', variants: { normal: true } }, undefined), []);
  });
});
