import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getSetCompletion } from '../lib/set-completion';
import type { CollectedPokemon } from '../lib/domain/cards';
import type { TCGSetSlotCard, TCGSetSlotsResponse } from '../lib/tcg-set-slots';

// Synthetic set and collection rows, not real card data.
const set = { id: 'fixture-set', name: 'Fixture set' };
const card = (localId: string, extra: Partial<TCGSetSlotCard> = {}): TCGSetSlotCard => ({
  id: `fixture-set-${localId}`,
  localId,
  name: `Fixture ${localId}`,
  language: 'en',
  set,
  inferredFinish: 'normal',
  ...extra,
});
const cards = [card('1'), card('2'), card('3')];
const payload: TCGSetSlotsResponse = {
  sets: [set],
  selectedSet: set,
  cards,
  slots: [{ dexId: 1, pokemonName: 'fixture', cards: [cards[0]] }],
};
const row = (
  pokemonId: number,
  cardId: string | undefined,
  status: CollectedPokemon['status'] = 'collected',
): CollectedPokemon => ({
  id: `row-${pokemonId}`,
  pokemon_id: pokemonId,
  pokemon_name: 'fixture',
  status,
  card_id: cardId,
  wanted_cards: [],
  collected_at: '2026-01-01',
});

describe('set completion', () => {
  test('counts cards tracked in binder slots against the full checklist', () => {
    assert.deepEqual(
      getSetCompletion(payload, [row(1, 'fixture-set-1'), row(2, 'fixture-set-3'), row(3, 'other-set-9')]),
      { owned: 2, total: 3, percent: 66, complete: false, hasFullCardList: true },
    );
  });

  test("wanted-only rows and slots without a printing don't count", () => {
    assert.equal(getSetCompletion(payload, [row(1, 'fixture-set-1', 'wishlisted'), row(2, undefined)]).owned, 0);
  });

  test('only a fully owned set is complete, and duplicates count once', () => {
    const all = [row(1, 'fixture-set-1'), row(2, 'fixture-set-2'), row(3, 'fixture-set-3'), row(4, 'fixture-set-3')];
    assert.deepEqual(getSetCompletion(payload, all), {
      owned: 3,
      total: 3,
      percent: 100,
      complete: true,
      hasFullCardList: true,
    });
  });

  test('alias ids match the canonical card', () => {
    const aliased: TCGSetSlotsResponse = {
      ...payload,
      cards: [card('1', { aliasIds: ['legacy-1'] } as Partial<TCGSetSlotCard>)],
    };
    assert.deepEqual(getSetCompletion(aliased, [row(1, 'legacy-1')]), {
      owned: 1,
      total: 1,
      percent: 100,
      complete: true,
      hasFullCardList: true,
    });
  });

  test('saved sets without a full checklist fall back to the Pokémon cards', () => {
    const saved: TCGSetSlotsResponse = { ...payload, cards: undefined };
    assert.deepEqual(getSetCompletion(saved, []), {
      owned: 0,
      total: 1,
      percent: 0,
      complete: false,
      hasFullCardList: false,
    });
    assert.equal(getSetCompletion({ ...saved, slots: [] }, []).percent, 0);
  });
});
