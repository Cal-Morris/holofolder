import test from 'node:test';
import assert from 'node:assert/strict';
import type { CollectedPokemon, WantedCard } from '../lib/domain/cards';
import { ABSENT_ROW_FINGERPRINT, collectionFingerprint } from '../lib/collection/sync';

const want = (card_id: string): WantedCard => ({ card_id, card_name: card_id, added_at: '2026-10-01T00:00:00.000Z' });

const row = (overrides: Partial<CollectedPokemon> = {}): CollectedPokemon => ({
  id: 'row-25',
  pokemon_id: 25,
  pokemon_name: 'pikachu',
  card_id: 'base1-58',
  card_name: 'Pikachu',
  card_language: 'en',
  card_finish: 'normal',
  wanted_cards: [],
  status: 'collected',
  collected_at: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

test('fingerprints ignore ids, names and timestamps but see status, printing and wanted cards', () => {
  assert.equal(collectionFingerprint(null), ABSENT_ROW_FINGERPRINT);
  assert.equal(
    collectionFingerprint(row()),
    collectionFingerprint(row({ id: 'other', card_name: 'x', collected_at: '2020-01-01' })),
  );
  assert.notEqual(collectionFingerprint(row()), collectionFingerprint(row({ status: 'finalized' })));
  assert.notEqual(collectionFingerprint(row()), collectionFingerprint(row({ card_finish: 'holo' })));
  assert.equal(
    collectionFingerprint(row({ wanted_cards: [want('a'), want('b')] })),
    collectionFingerprint(row({ wanted_cards: [want('b'), want('a')] })),
  );
});
