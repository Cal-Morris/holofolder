import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toCardImageSrc, toCardImageProxySrc } from '../lib/card-image-url';

const proxied = (url: string) => `/app/api/card-image-proxy?url=${encodeURIComponent(url)}`;

describe('toCardImageSrc', () => {
  test('serves TCGdex and fallback-source images from the public asset domain', () => {
    for (const [url, key] of [
      ['https://assets.tcgdex.net/en/me/30th/001/high.webp', 'pokemon/tcg/cards/en/30th/001/high.webp'],
      ['https://product-images.tcgplayer.com/162268.jpg', 'pokemon/tcg/cards/src/tcgplayer/162268.webp'],
      ['https://images.pokemontcg.io/smp/SM168_hires.png', 'pokemon/tcg/cards/src/pokemontcg/smp/SM168_hires.webp'],
      ['https://images.scrydex.com/pokemon/me55c-106p/large', 'pokemon/tcg/cards/src/scrydex/me55c-106p/large.webp'],
      [
        'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/MEP/MEP_001_R_EN_LG.png',
        'pokemon/tcg/cards/src/limitless/MEP/MEP_001_R_EN_LG.webp',
      ],
    ]) {
      assert.equal(toCardImageSrc(url), 'https://assets.holofolder.com/' + key);
      assert.equal(toCardImageSrc(proxied(url)), 'https://assets.holofolder.com/' + key);
      assert.equal(toCardImageProxySrc(url), proxied(url));
    }
  });

  test('keeps same-origin, data, blob and other-host images unchanged', () => {
    assert.equal(toCardImageSrc(' /app/api/card-image-proxy?url=x '), '/app/api/card-image-proxy?url=x');
    assert.equal(toCardImageSrc('data:image/png;base64,AA'), 'data:image/png;base64,AA');
    assert.equal(toCardImageSrc('blob:https://holofolder.com/1'), 'blob:https://holofolder.com/1');
    assert.equal(toCardImageSrc('https://example.com/card.png'), 'https://example.com/card.png');
  });

  test('drops empty and unusable values', () => {
    for (const value of [null, undefined, '', '  ', 'null', 'undefined', 'javascript:alert(1)', 'not a url', 42])
      assert.equal(toCardImageSrc(value), null);
  });
});

test('maps old-bucket URLs to the pokemon/tcg prefix', () => {
  for (const origin of ['https://assets.holofolder.com', 'https://pub-47cc306087724b00a06ee44b2d4ff58a.r2.dev']) {
    assert.equal(
      toCardImageSrc(`${origin}/cards/en/base1/44/high.webp`),
      'https://assets.holofolder.com/pokemon/tcg/cards/en/base1/44/high.webp',
    );
    assert.equal(
      toCardImageSrc(`${origin}/cards/src/tcgplayer/1.webp`),
      'https://assets.holofolder.com/pokemon/tcg/cards/src/tcgplayer/1.webp',
    );
  }
  assert.equal(
    toCardImageSrc('https://assets.holofolder.com/pokemon/tcg/cards/en/base1/44/high.webp'),
    'https://assets.holofolder.com/pokemon/tcg/cards/en/base1/44/high.webp',
  );
});

test('only proxies the playshop.fr path on the shared Shopify CDN', () => {
  const scan = 'https://cdn.shopify.com/s/files/1/1015/7057/6719/files/pokemon-2019sm-fr-1-bulbizarre.png';
  assert.equal(
    toCardImageSrc(scan),
    'https://assets.holofolder.com/pokemon/tcg/cards/src/playshop/pokemon-2019sm-fr-1-bulbizarre.webp',
  );
  const other = 'https://cdn.shopify.com/s/files/1/0000/0000/0001/files/logo.png';
  assert.equal(toCardImageSrc(other), other);
});

describe('small card renditions', () => {
  const base = 'https://assets.holofolder.com/';
  test('maps public objects to their stored small copy', async () => {
    const { toSmallCardAssetSrc, toCardThumbnailSrc } = await import('../lib/card-image-url');
    assert.equal(
      toSmallCardAssetSrc(`${base}pokemon/tcg/cards/en/sv01/001/high.webp`),
      `${base}pokemon/tcg/cards/en/sv01/001/low.webp`,
    );
    assert.equal(
      toSmallCardAssetSrc(`${base}pokemon/tcg/cards/src/malie/tcgl/me6/me6_en_001_std.webp`),
      `${base}pokemon/tcg/cards/src/malie/tcgl/me6/me6_en_001_std.low.webp`,
    );
    assert.equal(toSmallCardAssetSrc(`${base}pokemon/tcg/cards/src/malie/tcgl/me6/me6_en_001_std.low.webp`), null);
    assert.equal(toSmallCardAssetSrc('https://example.com/card.webp'), null);
    const malie = 'https://cdn.malie.io/file/malie-io/tcgl/cards/png/en/me6/me6_en_001_std.png';
    assert.deepEqual(toCardThumbnailSrc(malie), {
      src: `${base}pokemon/tcg/cards/src/malie/tcgl/me6/me6_en_001_std.low.webp`,
      full: `${base}pokemon/tcg/cards/src/malie/tcgl/me6/me6_en_001_std.webp`,
    });
    assert.equal(toCardThumbnailSrc(null), null);
  });

  test('card images offer the small copy in their srcset', async () => {
    const { getCardImageAttributes } = await import('../lib/card-image-loader');
    const source = `${base}pokemon/tcg/cards/src/malie/tcgl/me6/me6_en_001_std.webp`;
    assert.equal(
      getCardImageAttributes(source, '25vw').srcSet,
      `${base}pokemon/tcg/cards/src/malie/tcgl/me6/me6_en_001_std.low.webp 320w, ${source} 734w`,
    );
    const tcgdex = `${base}pokemon/tcg/cards/en/sv01/001/high.webp`;
    assert.equal(
      getCardImageAttributes(tcgdex, '25vw').srcSet,
      `${base}pokemon/tcg/cards/en/sv01/001/low.webp 320w, ${tcgdex} 600w`,
    );
  });

  test('the small rendition is 320 wide WebP', async () => {
    const { default: sharp } = await import('sharp');
    const { renderLowRendition } = await import('../lib/card-image-transform');
    // Synthetic 734 × 1024 grey image.
    const input = await sharp({ create: { width: 734, height: 1024, channels: 3, background: '#888888' } })
      .webp()
      .toBuffer();
    const output = await sharp(
      Buffer.from(
        await renderLowRendition(
          input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer,
        ),
      ),
    ).metadata();
    assert.equal(output.width, 320);
    assert.equal(output.format, 'webp');
  });
});
