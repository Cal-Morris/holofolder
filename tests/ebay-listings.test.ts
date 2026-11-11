import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEbayListings, summarizeEbayListingEvidence } from '../lib/ebay-listings';
import type { PriceSubject } from '../lib/price-intelligence';

// Synthetic card and listings; these are not market data.
const subject: PriceSubject = {
  cardId: 'base1-44',
  name: 'Bulbasaur',
  setId: 'base1',
  setName: 'Base Set',
  localId: '44',
  language: 'en',
  variant: 'normal',
};
const listing = (id: string, price: string, overrides = {}) => ({
  itemId: id,
  title: 'Pokemon Bulbasaur 44/102 Base Set',
  price: { value: price, currency: 'GBP' },
  itemLocation: { country: 'GB' },
  buyingOptions: ['FIXED_PRICE'],
  ...overrides,
});

test('eBay asks are a deduplicated sample, separate from sold prices, with postage excluded', () => {
  const result = summarizeEbayListings(subject, [
    listing('a', '10'),
    listing('b', '12'),
    listing('c', '20'),
    listing('a', '10'),
  ]);
  assert.deepEqual(result, { kind: 'asking', currency: 'GBP', count: 3, median: 12, low: 10, high: 20 });
  assert.equal(summarizeEbayListings(subject, []).median, null);
});

test('listing summary excludes wrong identities, foreign prices, auctions, slabs and ambiguous printing or language', () => {
  const invalid = [
    listing('a', '10', { title: 'Bulbasaur 144/102 Base Set' }),
    listing('b', '10', { title: 'Bulbasaur 44/102 Jungle' }),
    listing('c', '10', { title: 'PSA 10 Bulbasaur 44/102 Base Set' }),
    listing('d', '10', { title: 'Bulbasaur 44/102 Base Set reverse holo' }),
    listing('e', '10', { title: 'Bulbasaur 44/102 Base Set 1st Edition' }),
    listing('f', '10', { title: 'Bulbasaur 44/102 Base Set Japanese' }),
    listing('g', '10', { price: { value: '10', currency: 'USD' } }),
    listing('h', '10', { itemLocation: { country: 'US' } }),
    listing('i', '10', { buyingOptions: ['AUCTION'] }),
    listing('j', '10', { itemGroupHref: 'https://example.test/variations' }),
    listing('k', '0'),
    listing('l', '-1'),
    listing('m', 'NaN'),
    listing('qty1', '40', { title: 'Bulbasaur 44/102 Base Set x4' }),
    listing('qty2', '40', { title: '4x Bulbasaur 44/102 Base Set' }),
    listing('reverse', '10', { title: 'Bulbasaur 44/102 Base Set Reverse' }),
    listing('ger', '10', { title: 'Bulbasaur 44/102 Base Set GER' }),
    listing('hex', '0x10'),
    listing('accessory', '10', { title: 'Bulbasaur 44/102 Base Set poster' }),
  ];
  assert.equal(summarizeEbayListings(subject, invalid).count, 0);
  assert.equal(summarizeEbayListings({ ...subject, language: 'ja' }, [listing('n', '10')]).count, 0);
});

test('holo and reverse lookups require explicit finish evidence in the title', () => {
  const cards = [
    listing('a', '10'),
    listing('b', '15', { title: 'Bulbasaur 44/102 Base Set Holo' }),
    listing('c', '20', { title: 'Bulbasaur 44/102 Base Set Reverse Holo' }),
  ];
  assert.equal(summarizeEbayListings({ ...subject, variant: 'holo' }, cards).median, 15);
  assert.equal(summarizeEbayListings({ ...subject, variant: 'reverse' }, cards).median, 20);
  assert.equal(
    summarizeEbayListings({ ...subject, variant: 'reverse' }, [
      listing('d', '18', { title: 'Bulbasaur 44/102 Base Set Reverse' }),
    ]).median,
    18,
  );
});

test('LV.X card names are not mistaken for x-count bundles', () => {
  // Synthetic printing and prices for a real card-name shape.
  const levelX = { ...subject, name: 'Uxie LV.X', setName: 'Synthetic Set', setId: 'synthetic' };
  assert.equal(
    summarizeEbayListings(levelX, [listing('lvx', '12', { title: 'Uxie LV.X 44/102 Synthetic Set' })]).median,
    12,
  );
  assert.equal(
    summarizeEbayListings(levelX, [listing('lvx-lot', '48', { title: 'Uxie LV.X 44/102 Synthetic Set x4' })]).count,
    0,
  );
});

test('asking records and summary use the same deduplicated matched sample', () => {
  const result = summarizeEbayListingEvidence(subject, [
    listing('a', '10', { itemWebUrl: 'https://www.ebay.co.uk/itm/123456789012?mkcid=1', condition: 'Used' }),
    listing('a', '10'),
    listing('wrong', '99', { title: 'Bulbasaur Jungle' }),
  ]);
  assert.equal(result.summary.count, 1);
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0].amount, 10);
  assert.equal(result.listings[0].url, 'https://www.ebay.co.uk/itm/123456789012');
  assert.equal(result.listings[0].title, 'Pokemon Bulbasaur 44/102 Base Set');
});
