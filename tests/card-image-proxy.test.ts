import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { NextRequest } from 'next/server';
import { GET, isAllowedImageHost, isAllowedImageUrl, parseProxyImageWidth } from '../app/api/card-image-proxy/route';
import { FEATURED_CARDS, getFeaturedCardImageSrcSet, getFeaturedCardImageUrl } from '../lib/featured-cards';
import { getOfficialArtworkSourceUrl, getOfficialArtworkUrl } from '../lib/pokemon-artwork';

test('isAllowedImageHost allows mirrored card art fallback hosts', () => {
  assert.equal(isAllowedImageHost('assets.tcgdex.net'), true);
  assert.equal(isAllowedImageHost('images.pokemontcg.io'), true);
  assert.equal(isAllowedImageHost('product-images.tcgplayer.com'), true);
  assert.equal(isAllowedImageHost('images.scrydex.com'), true);
  assert.equal(isAllowedImageHost('limitlesstcg.nyc3.cdn.digitaloceanspaces.com'), true);
});

test('isAllowedImageHost rejects unrelated image hosts', () => {
  assert.equal(isAllowedImageHost('en.tcgdex.net'), false);
  assert.equal(isAllowedImageHost('example.com'), false);
  assert.equal(isAllowedImageHost('tcgplayer.com'), false);
  assert.equal(isAllowedImageHost('product-images.tcgplayer.com.evil.test'), false);
});

test('isAllowedImageUrl allows PokeAPI artwork on GitHub but nothing else there', () => {
  assert.equal(isAllowedImageUrl(new URL(getOfficialArtworkSourceUrl(25))), true);
  assert.equal(
    isAllowedImageUrl(new URL('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png')),
    true,
  );
  assert.equal(isAllowedImageUrl(new URL('https://raw.githubusercontent.com/someone/else/main/evil.png')), false);
  assert.equal(isAllowedImageUrl(new URL('https://raw.githubusercontent.com/PokeAPI/sprites/master/README.md')), false);
  assert.equal(
    isAllowedImageUrl(new URL('http://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png')),
    false,
  );
  assert.equal(isAllowedImageUrl(new URL('https://assets.tcgdex.net/en/base/base1/44/low.webp')), true);
  assert.equal(isAllowedImageUrl(new URL('ftp://assets.tcgdex.net/x.png')), false);
});

test('parseProxyImageWidth only accepts the fixed widths', () => {
  assert.equal(parseProxyImageWidth(null), null);
  assert.equal(parseProxyImageWidth('240'), 240);
  assert.equal(parseProxyImageWidth('241'), null);
  assert.equal(parseProxyImageWidth('abc'), null);
});

test('getOfficialArtworkUrl points at the proxy with a grid width by default', () => {
  const url = new URL(getOfficialArtworkUrl(25), 'https://holofolder.com');
  assert.equal(url.pathname, '/app/api/card-image-proxy');
  assert.equal(url.searchParams.get('url'), getOfficialArtworkSourceUrl(25));
  assert.equal(url.searchParams.get('w'), '240');
  assert.equal(new URL(getOfficialArtworkUrl(25, 480), 'https://x').searchParams.get('w'), '480');
});

test('isAllowedImageUrl allows only the playshop.fr store path on the shared Shopify CDN', () => {
  assert.equal(
    isAllowedImageUrl(new URL('https://cdn.shopify.com/s/files/1/1015/7057/6719/files/pokemon-2013bw-1-phyllali.png')),
    true,
  );
  assert.equal(isAllowedImageUrl(new URL('https://cdn.shopify.com/s/files/1/0000/0000/0001/files/logo.png')), false);
});

test('featured card srcset uses public stored variants while canonical artwork remains compatible', () => {
  const card = FEATURED_CARDS[0];
  const candidates = getFeaturedCardImageSrcSet(card).split(', ');
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((url) => url.startsWith('https://assets.holofolder.com/pokemon/tcg/cards/')));
  assert.ok(candidates[0].endsWith('/low.webp 320w'));
  assert.ok(candidates[1].endsWith('/high.webp 600w'));
  assert.ok(getFeaturedCardImageUrl(card).startsWith('/app/api/card-image-proxy?'));
});

test('isAllowedImageUrl rejects untrusted authorities and insecure transports', () => {
  for (const value of [
    'http://assets.tcgdex.net/x.png',
    'https://assets.tcgdex.net:8443/x.png',
    'https://user:password@assets.tcgdex.net/x.png',
    'https://assets.tcgdex.net.evil.test/x.png',
    'https://evil.test/assets.tcgdex.net/x.png',
    'https://en.tcgdex.net/x.png',
    'https://127.0.0.1/x.png',
    'https://product-images.tcgplayer.com:8080/123.jpg',
    'https://raw.githubusercontent.com:8443/PokeAPI/sprites/master/sprites/pokemon/25.png',
  ]) {
    assert.equal(isAllowedImageUrl(new URL(value)), false, value);
  }
  assert.equal(isAllowedImageUrl(new URL('https://assets.tcgdex.net:443/x.png')), true);
});

test('GET rejects invalid image authorities without making a request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('unexpected fetch');
  }) as typeof fetch;
  try {
    for (const url of ['https://127.0.0.1/image.png', 'https://assets.tcgdex.net:8443/image.png']) {
      const request = new NextRequest(
        `https://holofolder.com/app/api/card-image-proxy?${new URLSearchParams({ url })}`,
      );
      assert.equal((await GET(request)).status, 400);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET refuses upstream redirects without requesting their destination', async () => {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url!);
    response.writeHead(302, { location: '/private' });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const originalFetch = globalThis.fetch;
  const source = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png';
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), source);
    // Map the trusted origin to our local synthetic redirect fixture, preserving native redirect handling.
    return originalFetch(`http://127.0.0.1:${address.port}/image`, init);
  }) as typeof fetch;
  try {
    const request = new NextRequest(
      `https://holofolder.com/app/api/card-image-proxy?${new URLSearchParams({ url: source })}`,
    );
    const response = await GET(request);
    assert.equal(response.status, 502);
    assert.deepEqual(paths, ['/image']);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
});
