import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BlobAccessError, BlobNotFoundError, BlobServiceRateLimited, BlobStoreSuspendedError } from '@vercel/blob';
import {
  BLOB_RATE_LIMIT_COOLDOWN_MS,
  BLOB_UNAVAILABLE_COOLDOWN_MS,
  BlobStoreUnavailableError,
  createCardImageMirror,
  parseTcgdexCardImageUrl,
  toBlobStoreUnavailableError,
  type CardImageBlobDeps,
} from '../lib/card-image-blob';
import { mirrorSetImages } from '../lib/card-image-backfill';

const BLOB_BASE = 'https://store123.public.blob.vercel-storage.com/';
const ref = parseTcgdexCardImageUrl('https://assets.tcgdex.net/en/me/me05/001/high.webp')!;
const ref2 = parseTcgdexCardImageUrl('https://assets.tcgdex.net/en/me/me05/002/high.webp')!;

/** A store that Vercel has blocked: public URLs answer 403, SDK calls fail as unavailable. */
function blockedDeps(options: { knownBase?: boolean } = {}) {
  let clock = 1_000_000;
  const calls = { head: 0, put: 0, list: 0, tcgdex: 0, blobGet: 0 };
  const deps: CardImageBlobDeps = {
    now: () => clock,
    async head(pathname) {
      calls.head += 1;
      if (options.knownBase) return { url: `${BLOB_BASE}${pathname}` };
      throw new BlobStoreUnavailableError('This store has been suspended.');
    },
    async put() {
      calls.put += 1;
      throw new BlobStoreUnavailableError('This store has been suspended.');
    },
    async list() {
      calls.list += 1;
      throw new BlobStoreUnavailableError('This store has been suspended.');
    },
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(BLOB_BASE)) {
        calls.blobGet += 1;
        return new Response('Your store is blocked', { status: 403, headers: { 'content-type': 'text/plain' } });
      }
      calls.tcgdex += 1;
      return new Response(new Uint8Array([9, 9, 9]), { headers: { 'content-type': 'image/webp' } });
    }) as typeof fetch,
  };
  return { deps, calls, advance: (ms: number) => (clock += ms) };
}

describe('blocked Blob store', () => {
  test('a 403 from a blob URL trips the cooldown: later requests skip Blob and schedule no uploads', async () => {
    const { deps, calls, advance } = blockedDeps({ knownBase: true });
    const mirror = createCardImageMirror(deps);

    const first = await mirror.loadImage(ref);
    assert.equal(first.source, 'tcgdex');
    assert.equal(first.pendingUpload, undefined);
    assert.equal(calls.blobGet, 1);
    assert.equal(mirror.isBlobBlocked(), true);

    const second = await mirror.loadImage(ref2);
    assert.equal(second.source, 'tcgdex');
    assert.equal(second.pendingUpload, undefined);
    assert.deepEqual({ head: calls.head, blobGet: calls.blobGet, put: calls.put }, { head: 1, blobGet: 1, put: 0 });

    advance(BLOB_UNAVAILABLE_COOLDOWN_MS + 1);
    assert.equal(mirror.isBlobBlocked(), false);
    await mirror.loadImage(ref2);
    assert.equal(calls.blobGet, 2, 'Blob is retried once the cooldown has passed');
  });

  test("an SDK 'store suspended' error on head trips the cooldown", async () => {
    const { deps, calls } = blockedDeps();
    const mirror = createCardImageMirror(deps);

    const image = await mirror.loadImage(ref);
    assert.equal(image.source, 'tcgdex');
    assert.equal(image.pendingUpload, undefined);
    assert.equal(mirror.isBlobBlocked(), true);

    await mirror.loadImage(ref2);
    assert.equal(calls.head, 1);
    assert.equal(calls.tcgdex, 2);
  });

  test('backfill stops touching Blob or TCGdex once the store is blocked', async () => {
    const { deps, calls } = blockedDeps();
    const mirror = createCardImageMirror(deps);
    await assert.rejects(
      mirrorSetImages(mirror, 'me05', [{ seriesId: 'me', setId: 'me05', localId: '001', imageLanguages: ['en'] }], {
        languages: ['en'],
        qualities: ['high'],
      }),
      BlobStoreUnavailableError,
    );
    await assert.rejects(mirror.ensureMirrored(ref), BlobStoreUnavailableError);
    assert.deepEqual({ list: calls.list, tcgdex: calls.tcgdex, put: calls.put }, { list: 1, tcgdex: 0, put: 0 });
  });

  test('maps @vercel/blob store-level errors, not per-object ones', () => {
    assert.equal(toBlobStoreUnavailableError(new BlobStoreSuspendedError())?.cooldownMs, BLOB_UNAVAILABLE_COOLDOWN_MS);
    assert.equal(toBlobStoreUnavailableError(new BlobAccessError())?.cooldownMs, BLOB_UNAVAILABLE_COOLDOWN_MS);
    assert.equal(toBlobStoreUnavailableError(new BlobServiceRateLimited())?.cooldownMs, BLOB_RATE_LIMIT_COOLDOWN_MS);
    assert.equal(toBlobStoreUnavailableError(new BlobNotFoundError()), null);
    assert.equal(toBlobStoreUnavailableError(new Error('boom')), null);
  });
});
