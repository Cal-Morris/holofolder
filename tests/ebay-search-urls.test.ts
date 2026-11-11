import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardListingSearchQuery,
  priceCheckSearchQuery,
  ebayOpenListingsUrl,
  ebaySoldListingsUrl,
} from '../lib/ebay-search-urls';
import { isCardPriceCheck } from '../lib/card-price-checks';

test('open and sold eBay UK search links share the query and stay on trusted origin', () => {
  const open = new URL(ebayOpenListingsUrl('Charmeleon 005 151'));
  const sold = new URL(ebaySoldListingsUrl('Charmeleon 005 151'));
  for (const url of [open, sold]) {
    assert.equal(url.origin + url.pathname, 'https://www.ebay.co.uk/sch/i.html');
    assert.equal(url.searchParams.get('_nkw'), 'Charmeleon 005 151');
  }
  assert.equal(open.searchParams.get('LH_BIN'), '1');
  assert.equal(open.searchParams.get('LH_Sold'), null);
  assert.equal(sold.searchParams.get('LH_Sold'), '1');
  assert.equal(sold.searchParams.get('LH_Complete'), '1');
  assert.equal(sold.searchParams.get('LH_BIN'), null);
  const saved = {
    summary: { kind: 'sold', currency: 'GBP', count: 1, median: 9, low: 9, high: 9 },
    checkedAt: new Date().toISOString(),
    searchUrl: sold.toString(),
  };
  assert.equal(isCardPriceCheck(saved), true);
});

// Synthetic identities, not price evidence.
test('browser searches preserve printed numbers, stamps and exact finish without a lookup', () => {
  const card = {
    cardId: 'mep-001~12345',
    name: 'Bulbasaur (Pokémon Center)',
    localId: '001~12345',
    setName: 'MEP Black Star Promos',
  };
  assert.equal(cardListingSearchQuery(card, 'holo'), 'Bulbasaur 001 Pokémon Center holo -reverse');
  assert.equal(
    cardListingSearchQuery({ ...card, localId: undefined }, 'reverse_holo'),
    'Bulbasaur 001 Pokémon Center reverse holo',
  );
  assert.equal(cardListingSearchQuery({ cardId: 'mep-001~12345', name: 'Bulbasaur' }), 'Bulbasaur 001~12345');
  assert.equal(
    cardListingSearchQuery({ cardId: 'base1-44', name: 'Bulbasaur', setName: 'Base Set' }, 'normal'),
    'Bulbasaur 44 Base Set non holo -reverse',
  );
  assert.equal(
    cardListingSearchQuery({ cardId: 'tcgplayer-283831', name: 'Nickit', setName: 'Astral Radiance' }),
    'Nickit Astral Radiance',
  );
  assert.equal(
    cardListingSearchQuery({ cardId: 'tcgplayer-283831', name: 'Nickit', localId: '103', setName: 'Astral Radiance' }),
    'Nickit 103 Astral Radiance',
  );
  assert.equal(priceCheckSearchQuery('Bulbasaur', '001', 'Promos', 'Pokémon Center'), 'Bulbasaur 001 Pokémon Center');
  assert.equal(priceCheckSearchQuery('Bulbasaur', '44', 'Base Set'), 'Bulbasaur 44 Base Set');
});
