import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { NextRequest } from 'next/server';
import { GET, isAllowedImageUrl, parseProxyImageWidth } from '../app/api/card-image-proxy/route';
import { parseCardImageKey } from '../lib/tcgdex-card-image';
import { FEATURED_CARDS, getFeaturedCardImageSrcSet, getFeaturedCardImageUrl } from '../lib/featured-cards';
import { getOfficialArtworkSourceUrl, getOfficialArtworkUrl } from '../lib/pokemon-artwork';

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
  // Card images are requested by our key, never by an upstream URL.
  assert.equal(isAllowedImageUrl(new URL('https://assets.tcgdex.net/en/base/base1/44/low.webp')), false);
  assert.equal(isAllowedImageUrl(new URL('https://images.pokemontcg.io/base1/4.png')), false);
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

test('parseCardImageKey reads our print keys and nothing else', () => {
  assert.deepEqual(parseCardImageKey('pokemon/tcg/cards/fr/base1/44/high.webp'), {
    language: 'fr',
    setId: 'base1',
    localId: '44',
    quality: 'high',
    extension: 'webp',
  });
  for (const key of [
    'pokemon/tcg/cards/src/malie/tcgl/sv1/sv1_en_001_std.webp',
    'pokemon/tcg/cards/en/base1/44/huge.webp',
    'pokemon/tcg/cards/en/../44/high.webp',
    'cards/en/base1/44/high.webp',
    'pokemon/tcg/sets/base1/logo.webp',
  ])
    assert.equal(parseCardImageKey(key), null, key);
});

test('GET rejects keys that are not card images without making a request', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('unexpected fetch');
  }) as typeof fetch;
  try {
    for (const key of ['pokemon/tcg/sets/base1/logo.webp', '../secrets', 'pokemon/tcg/cards/src/../x.webp']) {
      const request = new NextRequest(
        `https://holofolder.com/app/api/card-image-proxy?${new URLSearchParams({ key })}`,
      );
      assert.equal((await GET(request)).status, 400, key);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    'https://raw.githubusercontent.com:8443/PokeAPI/sprites/master/sprites/pokemon/25.png',
    'https://user:pw@raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png',
    'https://raw.githubusercontent.com.evil.test/PokeAPI/sprites/master/sprites/pokemon/25.png',
    'https://127.0.0.1/x.png',
  ]) {
    assert.equal(isAllowedImageUrl(new URL(value)), false, value);
  }
});

test('GET rejects invalid image authorities without making a request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('unexpected fetch');
  }) as typeof fetch;
  try {
    for (const url of ['https://127.0.0.1/image.png', 'https://assets.tcgdex.net/en/base/base1/44/high.webp']) {
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
