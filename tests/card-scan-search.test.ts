import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCardTextSignals } from '../lib/card-scan-text';
import { identifyPocketCrop } from '../lib/card-scan-search';
import type { SearchCardResult } from '../lib/pokemon-card-browse';

// Synthetic test cards, not real catalog data.
const card = (id: string, name: string, localId: string, total: number, dexIds: number[]): SearchCardResult => ({
  id,
  name,
  localId,
  dexIds,
  set: { id: id.split('-')[0], name: `Set ${id.split('-')[0]}`, officialCardCount: total },
});
const PIKACHU_A = card('aa-025', 'Pikachu', '025', 165, [25]);
const PIKACHU_B = card('bb-058', 'Pikachu', '058', 102, [25]);
const PIKACHU_C = card('cc-160', 'Pikachu', '160', 198, [25]);

const readText = (text: string) => async () => extractCardTextSignals(text);
const noOfflineCards = async () => [];
const realFetch = globalThis.fetch;
const serve = (cards: SearchCardResult[]) => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ cards }))) as unknown as typeof fetch;
};

describe('identifyPocketCrop', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('offers the one card whose name and number both match', async () => {
    serve([PIKACHU_A, PIKACHU_B, PIKACHU_C]);
    const found = await identifyPocketCrop('crop', noOfflineCards, { recognize: readText('Pikachu\n025/165') });
    assert.deepEqual(found.candidates, [PIKACHU_A]);
    assert.equal(found.query, 'Pikachu');
  });

  test('a lone name-only hit is not offered, only searched for', async () => {
    serve([PIKACHU_B]);
    const found = await identifyPocketCrop('crop', noOfflineCards, { recognize: readText('Pikachu') });
    assert.deepEqual(found.candidates, []);
    assert.equal(found.query, 'Pikachu');
  });

  test('several likely cards become choices, never a single pick', async () => {
    serve([PIKACHU_A, PIKACHU_B, PIKACHU_C]);
    const found = await identifyPocketCrop('crop', noOfflineCards, { recognize: readText('Pikachu') });
    assert.equal(found.candidates.length, 3);
  });

  test('searches the cards on the device when the card search is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    const found = await identifyPocketCrop('crop', async () => [PIKACHU_A, PIKACHU_B], {
      recognize: readText('Pikachu\n058/102'),
    });
    assert.deepEqual(found.candidates, [PIKACHU_B]);
  });

  test('an unreadable or failing pocket is left for the user, without throwing', async () => {
    serve([PIKACHU_A]);
    assert.deepEqual(await identifyPocketCrop('crop', noOfflineCards, { recognize: async () => null }), {
      candidates: [],
      query: '',
    });
    const failing = async () => {
      throw new Error('reader download failed');
    };
    assert.deepEqual(await identifyPocketCrop('crop', noOfflineCards, { recognize: failing }), {
      candidates: [],
      query: '',
    });
  });

  test('gives up on a pocket whose read hangs (dead Wi-Fi)', async () => {
    const hang = () => new Promise<never>(() => {});
    assert.deepEqual(await identifyPocketCrop('crop', noOfflineCards, { recognize: hang, timeoutMs: 10 }), {
      candidates: [],
      query: '',
    });
  });
});
