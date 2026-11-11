import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BinderSlotImages } from '../lib/binder-slot-images';

test('page turns reuse and promote pending decodes, retain images and retry failures', async () => {
  const original = globalThis.Image;
  const images: FakeImage[] = [];
  class FakeImage {
    src = '';
    decoding = '';
    fetchPriority = '';
    removed = false;
    resolve!: () => void;
    reject!: () => void;
    promise = new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    constructor() {
      images.push(this);
    }
    decode() {
      return this.promise;
    }
    removeAttribute() {
      this.removed = true;
      this.reject();
    }
  }
  globalThis.Image = FakeImage as unknown as typeof Image;
  try {
    const cache = new BinderSlotImages();
    const prefetch = cache.load('next');
    assert.equal(cache.load('next', 'high'), prefetch);
    assert.equal(images.length, 1);
    assert.equal(images[0].fetchPriority, 'high');
    cache.retain(new Set(['next']));
    assert.equal(images[0].removed, false);
    images[0].resolve();
    await prefetch;
    assert.equal(cache.load('next'), prefetch);
    cache.retain(new Set());
    assert.equal(images[0].removed, true);
    const failed = cache.load('bad');
    images[1].reject();
    await failed;
    const retry = cache.load('bad');
    assert.equal(images.length, 3);
    images[2].resolve();
    await retry;
  } finally {
    globalThis.Image = original;
  }
});

test('prefetch selects responsive variants and replaces them when slot sizes change', async () => {
  const { getCardImageAttributes } = await import('../lib/card-image-loader');
  const original = globalThis.Image;
  const images: FakeImage[] = [];
  class FakeImage {
    src = '';
    sizes = '';
    srcset = '';
    removed: string[] = [];
    constructor() {
      images.push(this);
    }
    decode() {
      return Promise.resolve();
    }
    removeAttribute(name: string) {
      this.removed.push(name);
    }
  }
  globalThis.Image = FakeImage as unknown as typeof Image;
  try {
    const url = '/app/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fmock%2F1%2Flow.webp';
    const cache = new BinderSlotImages();
    await cache.load(url, 'low', '80px');
    const expected = getCardImageAttributes(url, '80px');
    assert.equal(images[0].src, expected.src);
    assert.equal(images[0].srcset, expected.srcSet);
    assert.equal(images[0].sizes, expected.sizes);
    await cache.load(url, 'high', '120px');
    assert.deepEqual(images[0].removed, ['srcset', 'src']);
    assert.equal(images[1].sizes, '120px');
    cache.retain(new Set([url]));
    assert.deepEqual(images[1].removed, []);
    cache.retain(new Set());
    assert.deepEqual(images[1].removed, ['srcset', 'src']);
  } finally {
    globalThis.Image = original;
  }
});
