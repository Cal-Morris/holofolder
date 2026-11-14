import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandSetSlotsResponse,
  slimSetSlotsResponse,
  type TCGSetSlotCard,
  type TCGSetSlotsResponse,
  type TCGSetSummary,
} from '../lib/tcg-set-slots';
import { createMemoryStore } from '../lib/offline-store/kv';
import { loadSetQuery, saveSetQuery } from '../lib/offline-store/records';
import { extractCardsFromCachedResponse } from '../lib/offline-card-index';
import { getLegacySetSlotsQuery, getSetSlotsQuery } from '../lib/card-show-prep';

// Synthetic set shaped like a large Scarlet & Violet expansion: 250 cards, 180 of them Pokémon (a few with two
// dex links), the rest trainers and energy. Values are made up; only the sizes and structure matter.
const SET: TCGSetSummary = {
  id: 'sv-fixture',
  name: 'Synthetic Fixture Set',
  seriesName: 'Scarlet & Violet',
  officialCardCount: 198,
  releaseDate: '2026-01-01',
};
const card = (n: number): TCGSetSlotCard => ({
  id: `sv-fixture-${String(n).padStart(3, '0')}`,
  localId: String(n).padStart(3, '0'),
  name: `Synthetic Card ${n}`,
  image: `https://assets.holofolder.com/pokemon/tcg/cards/en/sv/sv-fixture/${String(n).padStart(3, '0')}/high.webp`,
  language: 'en',
  languageConfirmed: true,
  set: SET,
  rarity: n > 198 ? 'Special Illustration Rare' : 'Common',
  variants: { normal: n <= 198, reverse: n <= 198, holo: n > 198, firstEdition: false, wPromo: false },
  inferredFinish: n > 198 ? 'holo' : 'normal',
});
/** What a client receives: JSON on the wire, so `undefined` fields drop out. */
const overWire = (value: unknown) => JSON.parse(String(JSON.stringify(value)));
const cards = Array.from({ length: 250 }, (_, i) => card(i + 1));
function fullResponse(): TCGSetSlotsResponse {
  const slots = new Map<number, TCGSetSlotsResponse['slots'][number]>();
  cards.slice(0, 180).forEach((c, i) => {
    for (const dexId of i % 30 === 0 ? [i + 1, i + 2] : [i + 1]) {
      const slot = slots.get(dexId) ?? { dexId, pokemonName: `Pokemon ${dexId}`, cards: [] };
      slot.cards.push(c);
      slots.set(dexId, slot);
    }
  });
  return { sets: [SET], selectedSet: SET, slots: [...slots.values()], cards };
}

test('the slim wire shape expands back to exactly the full response', () => {
  const full = fullResponse();
  const wire = overWire(slimSetSlotsResponse(full));
  assert.ok(wire.cards.every((c: object) => !('set' in c)));
  assert.ok(wire.slots.every((s: object) => !('cards' in s)));
  assert.deepEqual(expandSetSlotsResponse(wire), full);
});

test('the slim shape is well under half the size of the old one', () => {
  const full = fullResponse();
  const before = JSON.stringify(full).length;
  const after = JSON.stringify(slimSetSlotsResponse(full)).length;
  assert.ok(after < before * 0.45, `${before} -> ${after} bytes`);
});

test('older full payloads (saved or cached before the slim shape) pass through unchanged', () => {
  const full = fullResponse();
  assert.deepEqual(expandSetSlotsResponse(overWire(full)), full);
  const withoutCards = { ...full, cards: undefined };
  assert.deepEqual(expandSetSlotsResponse(withoutCards), withoutCards);
});

test('malformed saved slots and cards are passed on, not thrown on', () => {
  const odd = { sets: [], selectedSet: SET, slots: [null, { dexId: 1 }], cards: [null] } as never;
  assert.doesNotThrow(() => expandSetSlotsResponse(odd));
});

test('saved set lookups read back in full from either shape', async () => {
  const store = createMemoryStore();
  const full = fullResponse();
  await saveSetQuery(store, 'new', slimSetSlotsResponse(full));
  await saveSetQuery(store, 'old', full);
  assert.deepEqual(await loadSetQuery(store, 'new'), full);
  assert.deepEqual(await loadSetQuery(store, 'old'), full);
});

test('the offline card index reads cards from cached slim and old responses alike', () => {
  const full = fullResponse();
  const url = `/app/api/tcg-set-slots?${getSetSlotsQuery(SET)}`;
  const fromWire = extractCardsFromCachedResponse(url, overWire(slimSetSlotsResponse(full)));
  const fromOld = extractCardsFromCachedResponse(url, overWire(full));
  assert.equal(fromWire.length, 186);
  assert.deepEqual(fromWire, fromOld);
  assert.equal(fromWire[0].set.name, SET.name);
});

test('every consumer asks for a set with one query string; the pre-slim key stays readable', () => {
  assert.equal(getSetSlotsQuery(SET), 'query=Synthetic+Fixture+Set&setId=sv-fixture&v=2');
  assert.equal(getSetSlotsQuery(SET, 'ja'), 'query=Synthetic+Fixture+Set&setId=sv-fixture&language=ja&v=2');
  assert.equal(getLegacySetSlotsQuery(SET), 'query=Synthetic+Fixture+Set&setId=sv-fixture');
});
