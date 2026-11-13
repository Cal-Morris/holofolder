import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PICTURE_DIM,
  PICTURE_INPUT_SIZE,
  fingerprintFromHiddenState,
  preprocessCardImage,
} from '../lib/card-picture-fingerprint';
import {
  buildPictureIndex,
  collectedCardLanguages,
  decidePictureScan,
  findPictureMatches,
  orderByLanguage,
  pictureIndexLanguages,
  type PictureCandidate,
} from '../lib/card-picture-match';
import { readScannedCard } from '../lib/card-scan-identify';
import { extractCardTextSignals } from '../lib/card-scan-text';
import { cosine, FINGERPRINT_PREFIX, l2Normalize, quantizeInt8 } from '../lib/card-assets/fingerprints';
import { ONNX_RUNTIME_VERSION, PICTURE_INDEX_BASE_URL } from '../lib/card-picture-scanner';
import type { SearchCardResult } from '../lib/pokemon-card-browse';

// Synthetic vectors and cards throughout, not real fingerprints or catalog data.
const random = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
const vector = (seed: number) => l2Normalize(Array.from({ length: PICTURE_DIM }, random(seed)));

describe('preprocessCardImage', () => {
  const plane = PICTURE_INPUT_SIZE * PICTURE_INPUT_SIZE;
  test('rescales and normalises with the ImageNet mean and std, channels first', () => {
    const rgba = new Uint8ClampedArray(30 * 40 * 4).fill(255);
    const input = preprocessCardImage(rgba, 30, 40);
    assert.equal(input.length, 3 * plane);
    assert.ok(Math.abs(input[0] - (1 - 0.485) / 0.229) < 1e-6);
    assert.ok(Math.abs(input[plane] - (1 - 0.456) / 0.224) < 1e-6);
    assert.ok(Math.abs(input[2 * plane + plane - 1] - (1 - 0.406) / 0.225) < 1e-6);
  });

  test('samples from the top-left corner like libvips affine, ignoring alpha', () => {
    // Twice the size: output pixel x samples input pixel 2x exactly, so a column pattern survives unblended.
    const width = 2 * PICTURE_INPUT_SIZE;
    const height = 2 * PICTURE_INPUT_SIZE;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = (i % width) % 2 ? 0 : 255;
      rgba[i * 4 + 3] = 0;
    }
    const input = preprocessCardImage(rgba, width, height);
    const white = (1 - 0.485) / 0.229;
    for (let x = 0; x < 8; x++) assert.ok(Math.abs(input[x] - white) < 1e-6);
  });

  test('blends neighbours in 12-bit fixed point, rounding half up', () => {
    // 1.5× downscale of columns 0,100,0,100,…: output x=1 sits halfway between input 1 (100) and 2 (0) → 50.
    const width = 336;
    const rgba = new Uint8ClampedArray(width * 224 * 4);
    for (let i = 0; i < width * 224; i++) rgba[i * 4] = (i % width) % 2 ? 100 : 0;
    const input = preprocessCardImage(rgba, width, 224);
    const value = Math.round((input[1] * 0.229 + 0.485) * 255);
    assert.equal(value, 50);
  });
});

describe('fingerprintFromHiddenState', () => {
  test('takes the CLS token (first 384 values) and L2-normalises it', () => {
    const hidden = Array.from({ length: PICTURE_DIM * 3 }, (_, i) => (i < PICTURE_DIM ? 2 : 99));
    const fingerprint = fingerprintFromHiddenState(hidden);
    assert.equal(fingerprint.length, PICTURE_DIM);
    assert.ok(Math.abs(fingerprint[0] - 1 / Math.sqrt(PICTURE_DIM)) < 1e-7);
  });
});

describe('findPictureMatches', () => {
  const rows = Array.from({ length: 40 }, (_, i) => vector(i + 1));
  const ids = rows.map((_, i) => `set-${i}`);
  const bytes = new Uint8Array(rows.length * PICTURE_DIM);
  rows.forEach((row, i) => bytes.set(new Uint8Array(quantizeInt8(row).buffer), i * PICTURE_DIM));
  const index = buildPictureIndex('en', bytes, ids);

  test('scores each int8 row by cosine, the comparison the index build asks for', () => {
    const query = vector(7);
    const matches = findPictureMatches(query, [index], 40);
    for (const match of matches) {
      const row = quantizeInt8(rows[ids.indexOf(match.id)]);
      assert.ok(Math.abs(match.score - cosine(query, row)) < 1e-5);
    }
  });

  test('returns the k best, best first, across languages', () => {
    const ja = buildPictureIndex('ja', bytes.slice(0, 5 * PICTURE_DIM), ids.slice(0, 5));
    const matches = findPictureMatches(rows[3], [index, ja], 6);
    assert.equal(matches.length, 6);
    assert.deepEqual(
      matches.slice(0, 2).map((m) => `${m.language}:${m.id}`),
      ['en:set-3', 'ja:set-3'],
    );
    for (let i = 1; i < matches.length; i++) assert.ok(matches[i - 1].score >= matches[i].score);
  });

  test('rejects an index whose vectors and ids differ in length', () => {
    assert.throws(() => buildPictureIndex('en', new Uint8Array(PICTURE_DIM), ['a', 'b']));
  });
});

describe('languages', () => {
  test('keeps collected languages first, each part still in score order', () => {
    const ordered = orderByLanguage(
      [
        { id: 'a', language: 'ja', score: 0.9 },
        { id: 'b', language: 'en', score: 0.8 },
        { id: 'c', language: 'ja', score: 0.7 },
        { id: 'd', language: 'en', score: 0.6 },
      ],
      ['en'],
    );
    assert.deepEqual(
      ordered.map((m) => m.id),
      ['b', 'd', 'a', 'c'],
    );
  });

  test('maps card languages to the index languages that exist (only ja/ko prints have their own art)', () => {
    assert.deepEqual(pictureIndexLanguages(['fr', 'de'], ['en', 'ja']), ['en']);
    assert.deepEqual(pictureIndexLanguages(['ja'], ['en', 'ja']), ['ja']);
    assert.deepEqual(pictureIndexLanguages([], ['en', 'ja']), ['en']);
  });

  test('collected languages always include English, plus owned, wanted and preferred', () => {
    const collection = [{ card_language: 'ja', wanted_cards: [{ card_language: 'fr' }, {}] }, { wanted_cards: [] }];
    assert.deepEqual(collectedCardLanguages(collection, 'de').sort(), ['de', 'en', 'fr', 'ja']);
    assert.deepEqual(collectedCardLanguages([]), ['en']);
  });
});

describe('decidePictureScan', () => {
  const card = (id: string, name: string, localId: string, total: number, dexIds: number[]): SearchCardResult => ({
    id,
    name,
    localId,
    dexIds,
    set: { id: id.split('-')[0], name: id.split('-')[0], officialCardCount: total },
  });
  const pictures = (...cards: SearchCardResult[]): PictureCandidate[] =>
    cards.map((c, i) => ({ card: c, score: 0.8 - i * 0.01 }));
  const read = (text: string) => readScannedCard(text ? extractCardTextSignals(text) : null);
  const EEVEE = card('aa-133', 'Eevee', '133', 165, [133]);
  const PIKACHU_1 = card('bb-025', 'Pikachu', '25', 102, [25]);
  const PIKACHU_2 = card('cc-160', 'Pikachu', '160', 198, [25]);
  const MEW = card('dd-151', 'Mew', '151', 165, [151]);
  const SNORLAX = card('ee-143', 'Snorlax', '143', 165, [143]);
  const ONIX = card('ff-095', 'Onix', '95', 102, [95]);

  test('offers the one top-five picture the name read agrees with', () => {
    const decision = decidePictureScan(pictures(MEW, EEVEE, SNORLAX), read('Eevee HP 60'));
    assert.deepEqual(decision, { kind: 'match', card: EEVEE });
  });

  test('offers the one the number agrees with even when the name read is ambiguous', () => {
    const decision = decidePictureScan(pictures(PIKACHU_2, PIKACHU_1, MEW), read('Pikachu\n025/102'));
    assert.deepEqual(decision, { kind: 'match', card: PIKACHU_1 });
  });

  test('two equally agreeing pictures become choices, agreeing first', () => {
    const decision = decidePictureScan(pictures(MEW, PIKACHU_2, PIKACHU_1), read('Pikachu'));
    assert.equal(decision.kind, 'choose');
    assert.deepEqual(decision.kind === 'choose' && decision.candidates.slice(0, 3), [PIKACHU_2, PIKACHU_1, MEW]);
  });

  test('never picks from the picture alone', () => {
    const decision = decidePictureScan(pictures(MEW, EEVEE, SNORLAX, ONIX), read(''));
    assert.deepEqual(decision, { kind: 'choose', candidates: [MEW, EEVEE, SNORLAX, ONIX] });
  });

  test('ignores agreement below the top five, and never offers a lone choice', () => {
    const decision = decidePictureScan(pictures(MEW, SNORLAX, ONIX, PIKACHU_1, PIKACHU_2, EEVEE), read('Eevee'));
    assert.equal(decision.kind, 'choose');
    assert.equal(decision.kind === 'choose' && decision.candidates.length, 5);
    assert.deepEqual(decidePictureScan(pictures(MEW), read('')), { kind: 'choose', candidates: [] });
  });
});

describe('picture scanner delivery', () => {
  test('the WASM runtime it downloads matches the installed onnxruntime-web', () => {
    const installed = JSON.parse(readFileSync('node_modules/onnxruntime-web/package.json', 'utf8')).version;
    assert.equal(ONNX_RUNTIME_VERSION, installed);
  });

  test('reads the index from the published fingerprint folder', () => {
    if (process.env.NEXT_PUBLIC_PICTURE_INDEX_BASE_URL) return;
    assert.equal(PICTURE_INDEX_BASE_URL, `https://assets.holofolder.com/${FINGERPRINT_PREFIX}/`);
  });
});
