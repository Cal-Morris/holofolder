import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestCardPriceCheck } from '../lib/card-price-check-client';
// Synthetic source results.
test('manual source request preserves printing identity and validates source kind', async () => {
  const original = globalThis.fetch;
  let wrongKind = false;
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    const params = new URL(url, 'https://example.invalid').searchParams;
    assert.equal(params.get('finish'), 'any');
    assert.equal(params.get('cardId'), 'test-1');
    assert.equal(params.get('source'), 'soldcomps');
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    return Response.json({
      soldcomps: {
        summary: { kind: wrongKind ? 'asking' : 'sold', currency: 'GBP', count: 1, low: 10, high: 10, median: 10 },
        checkedAt: '2026-10-27T12:00:00Z',
      },
      errors: {},
    });
  }) as typeof fetch;
  try {
    assert.equal(
      (
        await requestCardPriceCheck(
          'test-1',
          'en',
          'special_illustration_rare',
          'soldcomps',
          new AbortController().signal,
        )
      ).check?.summary.median,
      10,
    );
    wrongKind = true;
    await assert.rejects(
      requestCardPriceCheck('test-1', 'en', 'special_illustration_rare', 'soldcomps', new AbortController().signal),
      /Invalid price check response/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('saved comparisons use a read-only request and validate both source kinds', async () => {
  const { readSavedCardPriceChecks } = await import('../lib/card-price-check-client');
  const original = globalThis.fetch;
  const sold = {
    summary: { kind: 'sold', currency: 'GBP', count: 1, low: 10, high: 10, median: 10 },
    checkedAt: '2025-01-01T12:00:00Z',
  };
  let wrongKind = false;
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    const params = new URL(url, 'https://example.invalid').searchParams;
    assert.equal(params.get('cardId'), 'test-1');
    assert.equal(params.get('language'), 'en');
    assert.equal(params.get('finish'), 'any');
    assert.equal(params.has('refresh'), false);
    assert.equal(options.method, 'GET');
    assert.equal(options.cache, 'no-store');
    return Response.json({
      ebay: null,
      soldcomps: wrongKind ? { ...sold, summary: { ...sold.summary, kind: 'asking' } } : sold,
      errors: {},
    });
  }) as typeof fetch;
  try {
    assert.equal(
      (await readSavedCardPriceChecks('test-1', 'en', 'special_illustration_rare', new AbortController().signal))
        .soldcomps?.summary.median,
      10,
    );
    wrongKind = true;
    await assert.rejects(
      readSavedCardPriceChecks('test-1', 'en', undefined, new AbortController().signal),
      /Invalid price check response/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
