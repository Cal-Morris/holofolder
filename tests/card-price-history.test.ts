import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePriceHistory, matchPriceProduct, priceHistoryFromRows } from '../lib/card-price-history';

// Synthetic provider fixtures, not market observations.
const card = { name: 'Carkol', number: 'SV068', setName: 'Shining Fates' };
const product = { productId: 123, name: 'Carkol', extendedData: [{ name: 'Number', value: 'SV068/SV122' }] };

test('price imports require the exact name, collector number, set and printing', () => {
  assert.equal(matchPriceProduct(card, product, 'Shining Fates: Shiny Vault'), true);
  assert.equal(matchPriceProduct(card, { ...product, name: 'Carkol (Staff)' }, 'Shining Fates'), false);
  assert.equal(matchPriceProduct(card, product, 'Other Set'), false);
  assert.equal(matchPriceProduct({ ...card, number: 'SV069' }, product, 'Shining Fates'), false);
  assert.equal(matchPriceProduct({ ...card, name: 'Rolycoly' }, product, 'Shining Fates'), false);
  assert.equal(matchPriceProduct({ ...card, setName: 'Base Set' }, product, 'Base Set 2'), false);
  assert.equal(matchPriceProduct({ ...card, setName: 'Base Set' }, product, 'Base Set (Shadowless)'), false);
  for (const [setName, group] of [
    ['Paldean Fates', 'SV: Paldean Fates'],
    ['Mega Evolution', 'ME01: Mega Evolution'],
    ['Ascended Heroes', 'ME: Ascended Heroes'],
    ['Cosmic Eclipse', 'SM - Cosmic Eclipse'],
    ['151', 'SV: Scarlet & Violet 151'],
    ['Hidden Fates Shiny Vault', 'Hidden Fates: Shiny Vault'],
    ['Wizards Black Star Promos', 'WoTC Promo'],
    ['DP Black Star Promos', 'Diamond and Pearl Promos'],
    ['Nintendo Black Star Promos', 'Nintendo Promos'],
    ['BW Black Star Promos', 'Black and White Promos'],
    ['SVP Black Star Promos', 'SV: Scarlet & Violet Promo Cards'],
  ]) {
    assert.equal(matchPriceProduct({ ...card, setName }, product, group), true, group);
  }
});

test('reviewed source spelling preserves gender, numbered full arts and Celebrations reprints', () => {
  for (const [name, number, sourceName] of [
    ['Nidoran♂', '43', 'Nidoran M'],
    ['Nidoran♀', '66', 'Nidoran (F)'],
    ['Latias-EX', '112', 'Latias EX (112 Full Art)'],
    ['Arceus', 'DP50', 'Arceus - DP50'],
    ['Articuno', '22', 'Articuno (22)'],
  ]) {
    assert.equal(
      matchPriceProduct(
        { name, number, setName: 'Synthetic set' },
        { name: sourceName, extendedData: [{ name: 'Number', value: number }] },
        'Synthetic set',
      ),
      true,
    );
  }
  assert.equal(
    matchPriceProduct(
      { name: 'Latias-EX', number: '112', setName: 'Synthetic set' },
      { name: 'Latias EX (111 Full Art)', extendedData: [{ name: 'Number', value: '112' }] },
      'Synthetic set',
    ),
    false,
  );
  assert.equal(
    matchPriceProduct(
      { name: 'Arceus', number: 'DP50', setName: 'Synthetic set' },
      { name: 'Arceus - DP51', extendedData: [{ name: 'Number', value: 'DP50' }] },
      'Synthetic set',
    ),
    false,
  );
  const reprint = { name: 'Donphan', number: '107A', setName: 'Celebrations' };
  const source = { name: 'Donphan (Prime)', extendedData: [{ name: 'Number', value: '107/123' }] };
  assert.equal(matchPriceProduct(reprint, source, 'Celebrations: Classic Collection'), true);
  assert.equal(matchPriceProduct({ ...reprint, number: '107' }, source, 'Celebrations: Classic Collection'), false);
  assert.equal(matchPriceProduct(reprint, source, 'HS—Unleashed'), false);
});

test('numbered TCGplayer names and split-card halves match the catalog name without losing the number check', () => {
  // Synthetic fixtures shaped like Mega Evolution groups (e.g. ME06: Delta Reign), not market observations.
  const numbered = { name: 'Masquerain - 003/103', extendedData: [{ name: 'Number', value: '003/103' }] };
  assert.equal(
    matchPriceProduct({ name: 'Masquerain', number: '003', setName: 'Delta Reign' }, numbered, 'ME06: Delta Reign'),
    true,
  );
  assert.equal(
    matchPriceProduct({ name: 'Masquerain', number: '3', setName: 'Delta Reign' }, numbered, 'ME06: Delta Reign'),
    true,
  );
  assert.equal(
    matchPriceProduct({ name: 'Masquerain', number: '104', setName: 'Delta Reign' }, numbered, 'ME06: Delta Reign'),
    false,
  );
  assert.equal(
    matchPriceProduct(
      { name: 'Masquerain', number: '003', setName: 'Delta Reign' },
      { ...numbered, name: 'Masquerain - 104/103' },
      'ME06: Delta Reign',
    ),
    false,
  );
  assert.equal(
    matchPriceProduct({ name: 'Masquerain', number: '003', setName: 'Pitch Black' }, numbered, 'ME06: Delta Reign'),
    false,
  );
  const left = { name: 'Legendary Pyroduct - 094/103 (Left)', extendedData: [{ name: 'Number', value: '094/103' }] };
  assert.equal(
    matchPriceProduct({ name: 'Legendary Pyroduct', number: '094', setName: 'Delta Reign' }, left, 'ME06: Delta Reign'),
    true,
  );
  assert.equal(
    matchPriceProduct({ name: 'Legendary Pyroduct', number: '095', setName: 'Delta Reign' }, left, 'ME06: Delta Reign'),
    false,
  );
  assert.equal(
    matchPriceProduct(
      { name: 'Lugia LEGEND', number: '113', setName: 'HeartGold SoulSilver' },
      { name: 'Lugia Legend (Top)', extendedData: [{ name: 'Number', value: '113/123' }] },
      'HeartGold SoulSilver',
    ),
    true,
  );
});

test('archive imports retain dated native prices and reject other products and ambiguous subtypes', () => {
  const points = priceHistoryFromRows(
    [
      { productId: 123, subTypeName: 'Holofoil', marketPrice: 4, lowPrice: 2 },
      { productId: 123, subTypeName: 'Reverse Holofoil', marketPrice: 5, lowPrice: 3 },
      { productId: 124, subTypeName: 'Normal', marketPrice: 10 },
      { productId: 123, subTypeName: '1st Edition Holofoil', marketPrice: 20 },
      { productId: 123, subTypeName: 'Normal', marketPrice: 0 },
    ],
    '123',
    '2026-09-15',
  );
  assert.equal(points.length, 2);
  assert.deepEqual(
    points.map((p) => [p.date, p.finish, p.currency, p.amount, p.lowAmount]),
    [
      ['2026-09-15', 'holo', 'USD', 4, 2],
      ['2026-09-15', 'reverse_holo', 'USD', 5, 3],
    ],
  );
});

test('history validation rejects malformed dates, invalid prices and currencies and deduplicates quotes', () => {
  const [point] = priceHistoryFromRows(
    [{ productId: 123, subTypeName: 'Normal', marketPrice: 4 }],
    '123',
    '2026-09-15',
  );
  assert.deepEqual(
    normalizePriceHistory([
      point,
      point,
      { ...point, date: '2026-02-30' },
      { ...point, amount: -1 },
      { ...point, amount: Infinity },
      { ...point, currency: 'GBP' },
      { ...point, finish: 'jumbo' },
    ]),
    [point],
  );
  assert.deepEqual(normalizePriceHistory(null), []);
});
