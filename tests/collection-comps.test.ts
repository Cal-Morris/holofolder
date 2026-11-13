import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionCompsTargets, inventoryCompsTargets } from '../lib/collection-comps';
import type { InventoryItem } from '../lib/domain/inventory';
import type { CollectedPokemon } from '../lib/domain/cards';

test('current binder targets use wanted printings and exclude wishlisted owned slots', () => {
  // Synthetic binder rows, no market or account data.
  const base: CollectedPokemon = {
    id: '1',
    pokemon_id: 1,
    pokemon_name: 'Synthetic',
    status: 'collected',
    collected_at: '',
    card_id: 'owned',
    card_language: 'en',
    card_finish: 'holo',
    wanted_cards: [
      { card_id: 'wanted', card_name: 'Synthetic wanted', card_language: 'ja', card_finish: 'normal', added_at: '' },
    ],
  };
  const rows = [base, { ...base, id: '2', status: 'wishlisted' as const, card_id: 'not-owned', wanted_cards: [] }];
  assert.deepEqual(collectionCompsTargets(rows, 'owned'), [{ cardId: 'owned', language: 'en', finish: 'holo' }]);
  assert.deepEqual(collectionCompsTargets(rows, 'wanted'), [{ cardId: 'wanted', language: 'ja', finish: 'normal' }]);
  assert.deepEqual(collectionCompsTargets([], 'owned'), []);
});

test('inventory targets every owned card copy and skips Pokémon-only copies', () => {
  // Synthetic inventory items, no market or account data.
  const item = (id: string, identity: InventoryItem['identity']): InventoryItem => ({
    id,
    ownerUserId: 'synthetic-owner',
    identity,
    grading: null,
    acquiredAt: null,
    version: 1,
  });
  assert.deepEqual(
    inventoryCompsTargets([
      item('a', { kind: 'card', cardId: 'synthetic-1', language: 'en', finish: 'holo' }),
      item('b', { kind: 'pokemon', pokemonId: 25 }),
      item('c', { kind: 'card', cardId: 'synthetic-2' }),
    ]),
    [
      { cardId: 'synthetic-1', language: 'en', finish: 'holo' },
      { cardId: 'synthetic-2', language: undefined, finish: undefined },
    ],
  );
});
