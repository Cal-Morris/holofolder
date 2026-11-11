import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCardImageMirror, type CardImageBlobDeps } from '../lib/card-image-blob';
import { mirrorSetImages, planSourceImageRefs } from '../lib/card-image-backfill';
import {
  isCardImageSourceUrl,
  pickExternalCardImageUrl,
  pickMirrorableSourceImage,
  parseSourceCardImageUrl,
} from '../lib/card-image-sources';
import { readCatalogMetadata } from '../lib/card-catalog';

const STORE = 'https://pub-test.r2.dev/';

function fakeDeps(options: { existing?: string[]; originStatus?: number } = {}) {
  const store = new Map<string, { body: ArrayBuffer; contentType: string }>(
    (options.existing ?? []).map((pathname) => [
      pathname,
      { body: new Uint8Array([1]).buffer, contentType: 'image/webp' },
    ]),
  );
  const calls = {
    origin: [] as string[],
    accept: [] as string[],
    put: [] as Array<{ pathname: string; contentType: string }>,
    head: 0,
    transform: 0,
  };
  const deps: CardImageBlobDeps = {
    baseUrl: STORE,
    async head(pathname) {
      calls.head += 1;
      return store.has(pathname) ? { url: `${STORE}${pathname}` } : null;
    },
    async put(pathname, body, contentType) {
      calls.put.push({ pathname, contentType });
      store.set(pathname, { body, contentType });
      return { url: `${STORE}${pathname}` };
    },
    async list(prefix) {
      return [...store.keys()].filter((pathname) => pathname.startsWith(prefix));
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(STORE)) {
        const hit = store.get(url.slice(STORE.length));
        return hit
          ? new Response(hit.body, { headers: { 'content-type': hit.contentType } })
          : new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      calls.origin.push(url);
      calls.accept.push(String(new Headers(init?.headers).get('accept')));
      const status = options.originStatus ?? 200;
      return status === 200
        ? new Response(new Uint8Array([7, 7, 7]), { headers: { 'content-type': 'image/png' } })
        : new Response('nope', { status, headers: { 'content-type': 'text/plain' } });
    }) as typeof fetch,
    async transformSourceImage(image) {
      calls.transform += 1;
      return { body: image.body, contentType: 'image/webp' };
    },
  };
  return { deps, store, calls };
}

describe('parseSourceCardImageUrl', () => {
  test('maps each fallback source to a deterministic WebP key', () => {
    const cases: Array<[string, string]> = [
      ['https://product-images.tcgplayer.com/716203.jpg', 'pokemon/tcg/cards/src/tcgplayer/716203.webp'],
      ['https://images.pokemontcg.io/smp/SM168_hires.png', 'pokemon/tcg/cards/src/pokemontcg/smp/SM168_hires.webp'],
      ['https://images.pokemontcg.io/ex10/!_hires.png', 'pokemon/tcg/cards/src/pokemontcg/ex10/exclamation_hires.webp'],
      ['https://images.scrydex.com/pokemon/me55c-106p/large', 'pokemon/tcg/cards/src/scrydex/me55c-106p/large.webp'],
      [
        'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/MEP/MEP_001_R_EN_LG.png',
        'pokemon/tcg/cards/src/limitless/MEP/MEP_001_R_EN_LG.webp',
      ],
    ];
    for (const [url, pathname] of cases) {
      assert.equal(parseSourceCardImageUrl(url)?.pathname, pathname, url);
    }
  });

  test('rejects other hosts, schemes, queries and unexpected paths', () => {
    for (const url of [
      'https://assets.tcgdex.net/en/me/me05/001/high.webp',
      'http://product-images.tcgplayer.com/716203.jpg',
      'https://product-images.tcgplayer.com/716203.jpg?x=1',
      'https://product-images.tcgplayer.com/fit-in/437x437/716203.jpg',
      'https://product-images.tcgplayer.com.evil.test/716203.jpg',
      'https://images.pokemontcg.io/../secret.png',
      'https://images.scrydex.com/pokemon/me55c-4/huge',
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/limitless/logo.png',
      'not a url',
    ]) {
      assert.equal(parseSourceCardImageUrl(url), null, url);
    }
  });
});

describe('pickMirrorableSourceImage', () => {
  test('uses the reviewed catalog image even when TCGdex has languages', () => {
    const ref = pickMirrorableSourceImage({
      imageLanguages: ['en'],
      externalIds: { catalog: { image: 'https://images.scrydex.com/pokemon/me55c-4/large' } },
    });
    assert.equal(ref?.source, 'scrydex');
  });

  test('falls back to pokemontcg, then TCGplayer, only without TCGdex languages', () => {
    const externalIds = {
      pokemon_tcg: { imageLarge: 'https://images.pokemontcg.io/smp/SM168_hires.png' },
      tcgdex: { thirdParty: { tcgplayer: 1 } },
    };
    assert.equal(pickMirrorableSourceImage({ imageLanguages: [], externalIds })?.source, 'pokemontcg');
    assert.equal(pickMirrorableSourceImage({ imageLanguages: ['en'], externalIds }), null);
    assert.equal(
      pickMirrorableSourceImage({ imageLanguages: [], externalIds: { tcgdex: { thirdParty: { tcgplayer: 42 } } } })
        ?.pathname,
      'pokemon/tcg/cards/src/tcgplayer/42.webp',
    );
  });

  test('ignores TCGdex images (those use the TCGdex mirror keys)', () => {
    assert.equal(
      pickMirrorableSourceImage({
        imageLanguages: [],
        externalIds: { tcgdex: { image: 'https://assets.tcgdex.net/en/me/30th/001/high.webp' } },
      }),
      null,
    );
    assert.equal(
      pickExternalCardImageUrl({ tcgdex: { image: 'https://assets.tcgdex.net/en/me/30th/001/high.webp' } }),
      'https://assets.tcgdex.net/en/me/30th/001/high.webp',
    );
  });

  test('catalog images may come from Scrydex and Limitless', () => {
    assert.equal(
      readCatalogMetadata({ catalog: { image: 'https://images.scrydex.com/pokemon/me55c-4/large' } }).image,
      'https://images.scrydex.com/pokemon/me55c-4/large',
    );
    assert.equal(
      readCatalogMetadata({
        catalog: { image: 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/MEP/MEP_001_R_EN_LG.png' },
      }).image?.startsWith('https://limitlesstcg.'),
      true,
    );
    assert.equal(readCatalogMetadata({ catalog: { image: 'https://example.com/a.png' } }).image, undefined);
  });
});

describe('source image mirroring', () => {
  const ref = parseSourceCardImageUrl('https://images.scrydex.com/pokemon/me55c-106p/large')!;

  test('serves the origin once, uploads the transformed copy, then serves the store', async () => {
    const { deps, calls } = fakeDeps();
    const mirror = createCardImageMirror(deps);
    const first = await mirror.loadSourceImage(ref);
    assert.equal(first.source, 'upstream');
    assert.equal(first.contentType, 'image/webp');
    await first.pendingUpload?.();
    assert.deepEqual(calls.put, [
      { pathname: 'pokemon/tcg/cards/src/scrydex/me55c-106p/large.webp', contentType: 'image/webp' },
    ]);
    const second = await mirror.loadSourceImage(ref);
    assert.equal(second.source, 'blob');
    assert.equal(calls.origin.length, 1);
  });

  test('never asks a fallback source for AVIF (the WebP conversion cannot decode it)', async () => {
    const { deps, calls } = fakeDeps();
    const mirror = createCardImageMirror(deps);
    const ref = parseSourceCardImageUrl('https://images.scrydex.com/pokemon/me55c-4/large')!;
    await mirror.ensureSourceMirrored(ref, { assumeMissing: true });
    assert.equal(calls.accept.length, 1);
    assert.doesNotMatch(calls.accept[0], /avif/);
  });

  test('ensureSourceMirrored skips existing copies and reports origin 404s', async () => {
    const existing = fakeDeps({ existing: [ref.pathname] });
    assert.deepEqual(await createCardImageMirror(existing.deps).ensureSourceMirrored(ref), {
      url: `${STORE}${ref.pathname}`,
      uploaded: false,
    });
    assert.equal(existing.calls.origin.length, 0);

    const missing = fakeDeps({ originStatus: 404 });
    await assert.rejects(
      createCardImageMirror(missing.deps).ensureSourceMirrored(ref),
      (error: { status?: number }) => error.status === 404,
    );
    assert.equal(missing.calls.put.length, 0);
  });

  test('set backfill copies fallback images once per key alongside TCGdex images', async () => {
    const { deps, calls } = fakeDeps({ existing: ['pokemon/tcg/cards/src/tcgplayer/1.webp'] });
    const cards = [
      {
        seriesId: 'me',
        setId: 'mep',
        localId: '001',
        imageLanguages: [],
        externalIds: { catalog: { image: 'https://product-images.tcgplayer.com/1.jpg' } },
      },
      {
        seriesId: 'me',
        setId: 'mep',
        localId: '002',
        imageLanguages: [],
        externalIds: { catalog: { image: 'https://product-images.tcgplayer.com/2.jpg' } },
      },
      {
        seriesId: 'me',
        setId: 'mep',
        localId: '002~9',
        imageLanguages: [],
        externalIds: { catalog: { image: 'https://product-images.tcgplayer.com/2.jpg' } },
      },
      { seriesId: 'me', setId: 'mep', localId: '003', imageLanguages: [], externalIds: {} },
    ];
    assert.equal(planSourceImageRefs(cards).length, 2);
    const result = await mirrorSetImages(createCardImageMirror(deps), 'mep', cards, {
      languages: ['en'],
      qualities: ['high', 'low'],
    });
    assert.equal(result.planned, 2);
    assert.equal(result.alreadyMirrored, 1);
    assert.equal(result.uploaded, 1);
    assert.equal(result.sourceUploaded, 1);
    assert.equal(result.complete, true);
    assert.deepEqual(calls.origin, ['https://product-images.tcgplayer.com/2.jpg']);
    assert.equal(calls.transform, 1);
  });
});

describe('playshop source', () => {
  test('accepts only the playshop.fr store path on the shared Shopify CDN', () => {
    const ok = 'https://cdn.shopify.com/s/files/1/1015/7057/6719/files/pokemon-2018sm-fr-1-feuillajou.png';
    assert.equal(
      parseSourceCardImageUrl(ok)?.pathname,
      'pokemon/tcg/cards/src/playshop/pokemon-2018sm-fr-1-feuillajou.webp',
    );
    assert.equal(isCardImageSourceUrl(new URL(ok)), true);
    for (const other of [
      'https://cdn.shopify.com/s/files/1/0000/0000/0001/files/pokemon-2018sm-fr-1-feuillajou.png',
      'https://cdn.shopify.com/s/files/1/1015/7057/6719/files/../x.png',
      'https://cdn.shopify.com/shopifycloud/anything.js',
    ]) {
      assert.equal(isCardImageSourceUrl(new URL(other)), false, other);
    }
    assert.equal(parseSourceCardImageUrl(`${ok}?v=1`), null);
    assert.equal(isCardImageSourceUrl(new URL('https://images.scrydex.com/pokemon/mep-120/large')), true);
  });
});
