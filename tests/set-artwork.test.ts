import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicSetArtworkUrl } from '../lib/set-browse';
import artwork from '../card-assets/pokemon/tcg/set-artwork.json';
import { getSetArtwork } from '../lib/set-artwork';
import { parseSetSymbols } from '../scripts/card-assets/mirror-sets';

test('set artwork permits only our public CDN set objects, including old cached payloads', () => {
  const url = 'https://assets.holofolder.com/pokemon/tcg/sets/fixture/symbol-123.webp';
  assert.equal(publicSetArtworkUrl(url), url);
  for (const source of [
    undefined,
    'https://pokesymbols.com/images/tcg/sets/symbols/fixture.png',
    'https://assets.holofolder.com.evil.test/pokemon/tcg/sets/x.png',
    `${url}?token=private`,
    `${url}#x`,
    'javascript:alert(1)',
  ])
    assert.equal(publicSetArtworkUrl(source), null);
});

test('symbol discovery preserves source paths and matches names, never unrelated images', () => {
  const symbols = parseSetSymbols(
    '<img alt="Sun &amp; Moon" width="600" src="/images/tcg/sets/symbols/sun-and-moon.png"/><img alt="Card" src="/other.png"/>',
  );
  assert.deepEqual([...symbols], [['sm', 'https://pokesymbols.com/images/tcg/sets/symbols/sun-and-moon.png']]);
});

test('published set artwork contains only CDN URLs and retains source attribution separately', () => {
  assert.deepEqual(getSetArtwork('synthetic-missing-set'), {});
  assert.ok(getSetArtwork('sm1').symbol);
  for (const [id, assets] of Object.entries(artwork)) {
    for (const asset of Object.values(assets)) {
      assert.equal(publicSetArtworkUrl(asset.url), asset.url);
      assert.ok(asset.url.includes(`/sets/${id}/`));
      assert.ok(asset.source.startsWith('https://'));
    }
    assert.equal('source' in getSetArtwork(id), false);
  }
});
