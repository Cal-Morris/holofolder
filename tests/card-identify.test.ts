import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeIdentifyImage,
  identifyLanguages,
  parseNumberHint,
  pictureConfidence,
  shapeIdentifyResult,
  IDENTIFY_MAX_IMAGE_BYTES,
} from '../lib/card-identify';
import { DEVELOPER_OPERATIONS, matchRestOperation } from '../lib/developer-api/operations';
import { hashedClientIp } from '../lib/server/developer-access/limits';

// Synthetic cards and scores throughout, not catalog data or real fingerprints.
const card = (id: string, name: string, localId: string, officialCardCount: number) => ({
  id,
  name,
  localId,
  set: { officialCardCount },
});
const PIKACHU_BASE = card('aa-58', 'Pikachu', '58', 102);
const PIKACHU_JUNGLE = card('bb-60', 'Pikachu', '60', 64);
const RAICHU = card('aa-14', 'Raichu', '14', 102);
const MEW = card('cc-8', 'Mew', '8', 53);
const matches = (...cards: ReturnType<typeof card>[]) =>
  cards.map((c, index) => ({ card: c, similarity: 0.8 - index * 0.01 }));

describe('decodeIdentifyImage', () => {
  test('decodes base64 and a data URL alike', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    assert.deepEqual([...(decodeIdentifyImage(bytes.toString('base64')) as Uint8Array)], [...bytes]);
    assert.deepEqual(
      [...(decodeIdentifyImage(`data:image/jpeg;base64,${bytes.toString('base64')}`) as Uint8Array)],
      [...bytes],
    );
  });

  test('rejects text that is not base64, and images over the limit', () => {
    assert.equal(typeof decodeIdentifyImage('not an image!'), 'string');
    assert.equal(typeof decodeIdentifyImage(''), 'string');
    const big = Buffer.alloc(IDENTIFY_MAX_IMAGE_BYTES + 3).toString('base64');
    assert.match(decodeIdentifyImage(big) as string, /at most 3 MB/);
  });
});

describe('hints', () => {
  test('parseNumberHint splits the number and the set total', () => {
    assert.deepEqual(parseNumberHint('025/102'), { number: '025', total: '102' });
    assert.deepEqual(parseNumberHint(' TG05 '), { number: 'TG05', total: null });
    assert.equal(parseNumberHint(''), null);
    assert.equal(parseNumberHint(undefined), null);
  });

  test('identifyLanguages maps card languages onto the picture indexes', () => {
    assert.equal(identifyLanguages(undefined), null);
    assert.deepEqual(identifyLanguages('ja'), ['ja']);
    assert.deepEqual(identifyLanguages('fr'), ['en']);
    assert.deepEqual(identifyLanguages('ko'), ['en']);
  });
});

describe('pictureConfidence', () => {
  test('uses the measured thresholds and margin', () => {
    assert.equal(pictureConfidence([]), 'none');
    assert.equal(pictureConfidence([0.8, 0.76]), 'high');
    assert.equal(pictureConfidence([0.77, 0.73]), 'medium');
    assert.equal(pictureConfidence([0.8, 0.79]), 'low');
    assert.equal(pictureConfidence([0.7]), 'low');
  });
});

describe('shapeIdentifyResult', () => {
  test('without hints: candidates in picture order with a picture-only label, no agreement fields', () => {
    const result = shapeIdentifyResult(matches(PIKACHU_JUNGLE, PIKACHU_BASE, MEW), {});
    assert.equal(result.confidence, 'low');
    assert.deepEqual(
      result.candidates.map((c) => [c.card.id, c.similarity, 'agrees' in c, 'confirmed' in c]),
      [
        ['bb-60', 0.8, false, false],
        ['aa-58', 0.79, false, false],
        ['cc-8', 0.78, false, false],
      ],
    );
  });

  test('number and set total agreeing with one of the top five confirms it, without reordering', () => {
    const result = shapeIdentifyResult(matches(PIKACHU_JUNGLE, PIKACHU_BASE, MEW), {
      name: 'Pikachu',
      number: '058/102',
    });
    assert.equal(result.confidence, 'confirmed');
    assert.deepEqual(result.candidates[0].agrees, { name: true, number: false, setTotal: false });
    assert.deepEqual(result.candidates[1].agrees, { name: true, number: true, setTotal: true });
    assert.equal(result.candidates[1].confirmed, true);
    assert.equal(result.candidates[0].confirmed, undefined);
  });

  test('a name alone, or a number without its total, never confirms', () => {
    const named = shapeIdentifyResult(matches(MEW, PIKACHU_BASE), { name: 'Pikachu' });
    assert.notEqual(named.confidence, 'confirmed');
    assert.deepEqual(named.candidates[1].agrees, { name: true, number: null, setTotal: null });
    const numbered = shapeIdentifyResult(matches(MEW, RAICHU), { number: '14' });
    assert.notEqual(numbered.confidence, 'confirmed');
  });

  test('the confirmed card is included past a small limit', () => {
    const result = shapeIdentifyResult(matches(MEW, RAICHU, PIKACHU_JUNGLE, PIKACHU_BASE), { number: '58/102' }, 1);
    assert.equal(result.confidence, 'confirmed');
    assert.deepEqual(
      result.candidates.map((c) => c.card.id),
      ['cc-8', 'aa-14', 'bb-60', 'aa-58'],
    );
    assert.equal(result.candidates.at(-1)?.confirmed, true);
  });
});

describe('identify_card operation', () => {
  const operation = DEVELOPER_OPERATIONS.find((op) => op.name === 'identify_card')!;

  test('is POST /cards/identify, read-only catalog access, with a body cap under Vercel’s 4.5 MB', () => {
    assert.equal(matchRestOperation('POST', '/cards/identify')?.operation.name, 'identify_card');
    assert.equal(matchRestOperation('GET', '/cards/identify')?.operation.name, 'get_card');
    assert.deepEqual(operation.permissions, ['catalog:read']);
    assert.equal(operation.write, false);
    assert.ok(operation.maxBytes! + 65536 < 4.5 * 1024 * 1024);
  });

  test('validates its input strictly', () => {
    assert.ok(operation.schema.safeParse({ image: 'aGk=', name: 'Pikachu', number: '58/102', language: 'ja' }).success);
    assert.ok(!operation.schema.safeParse({}).success);
    assert.ok(!operation.schema.safeParse({ image: 'aGk=', limit: 21 }).success);
    assert.ok(!operation.schema.safeParse({ image: 'aGk=', language: 'xx' }).success);
    assert.ok(!operation.schema.safeParse({ image: 'aGk=', pick: true }).success);
  });
});

describe('hashedClientIp', () => {
  test('is off outside Vercel and never returns the address itself', () => {
    const request = new Request('https://example.invalid/', { headers: { 'x-vercel-forwarded-for': '203.0.113.7' } });
    const vercel = process.env.VERCEL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      delete process.env.VERCEL;
      assert.equal(hashedClientIp(request), null);
      process.env.VERCEL = '1';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
      const hashed = hashedClientIp(request)!;
      assert.match(hashed, /^[0-9a-f]{64}$/);
      assert.ok(!hashed.includes('203.0.113.7'));
      assert.notEqual(
        hashed,
        hashedClientIp(
          new Request('https://example.invalid/', { headers: { 'x-vercel-forwarded-for': '203.0.113.8' } }),
        ),
      );
    } finally {
      if (vercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = vercel;
      if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    }
  });
});
