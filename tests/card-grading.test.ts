import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGradingRecord } from '@/lib/domain/inventory';
import type { InventoryItem } from '@/lib/domain/inventory';
import {
  duplicateGradingCopies,
  emptyGradingRecord,
  gradingEditCommand,
  gradingReviewNotes,
} from '@/lib/grading/draft';
import { parseOfficialGradingUrl, privateGradingLink } from '@/lib/grading/provider-links';
import { buildInventoryBrowseIndex } from '@/lib/inventory-query';
import { inventoryBrowseFixture } from '@/tests/fixtures/inventory-browse';
import { parseInventoryCommand } from '@/lib/domain/inventory-commands';

// All records in this suite are synthetic. No external lookup is performed.
const item = (id = 'synthetic-copy'): InventoryItem => ({
  id,
  ownerUserId: 'synthetic-owner',
  identity: { kind: 'card', cardId: 'synthetic-card' },
  grading: { ...emptyGradingRecord(), certificate: '00001234' },
  acquiredAt: '2026-01-01T00:00:00Z',
  version: 4,
});
const ref = { itemId: 'synthetic-copy', itemVersion: 4, placement: null };

describe('manual per-copy grading drafts', () => {
  test('canonical round trips keep custom text, punctuation, legacy label, qualifiers, subgrades and private asset IDs', () => {
    const grading = {
      ...emptyGradingRecord(),
      provider: { kind: 'custom' as const, name: 'Synthetic grader' },
      grade: 'Authentic / vintage',
      scale: 'legacy v1',
      certificate: '000-012.34',
      designation: 'OC',
      subgrades: [{ name: 'Corners', grade: '9.5' }],
      holder: 'Older holder',
      label: { variant: 'Handwritten custom style', assetIds: ['synthetic-private-label'] },
    };
    assert.deepEqual(normalizeGradingRecord(grading), grading);
    assert.deepEqual(gradingEditCommand(item(), ref, grading).grading, grading);
    assert.equal(normalizeGradingRecord({ ...grading, certificate: 1234 }), undefined);
    assert.equal(normalizeGradingRecord({ ...grading, provider: { kind: 'known', id: 'becket' } }), undefined);
    assert.equal(normalizeGradingRecord({ ...grading, provider: { kind: 'custom', name: ' ' } }), undefined);
  });

  test('commands edit one stable copy with version/placement, never add or reacquire', () => {
    const a = item(),
      b = item('synthetic-other'),
      before = structuredClone([a, b]);
    const draft = { ...emptyGradingRecord(), grade: '9.5' };
    const command = gradingEditCommand(a, ref, draft);
    assert.deepEqual(command, { kind: 'edit', item: ref, grading: draft });
    parseInventoryCommand({
      operationId: 'synthetic-edit-001',
      inventoryRevision: 3,
      collections: [],
      commands: [command],
    });
    assert.deepEqual([a, b], before);
    assert.deepEqual(gradingEditCommand(a, ref, null), { kind: 'edit', item: ref, grading: null });
    assert.throws(() => gradingEditCommand(b, ref, draft));
    assert.throws(() => gradingEditCommand({ ...a, version: 5 }, ref, draft));
    assert.throws(() =>
      gradingEditCommand({ ...a, identity: { kind: 'pokemon', pokemonId: 1 }, grading: null }, ref, draft),
    );
    const placed = {
      ...ref,
      placement: {
        collectionId: '03830000-0000-4000-8000-000000000011',
        slot: {
          id: 'synthetic-slot',
          version: 5,
          inventoryItemId: a.id,
          itemVersion: a.version,
          placementVersion: 2,
        },
      },
    };
    assert.deepEqual(gradingEditCommand(a, placed, draft).item, placed);
    assert.throws(() =>
      gradingEditCommand(
        a,
        { ...placed, placement: { ...placed.placement, slot: { ...placed.placement.slot, itemVersion: 3 } } },
        draft,
      ),
    );
  });

  test('unknown and provider-specific grades remain recorded strings, warnings never normalize/regrade', () => {
    assert.equal(emptyGradingRecord().grade, null);
    for (const id of ['psa', 'ace', 'cgc', 'beckett'] as const) {
      for (const grade of [null, '9.5', 'Authentic', 'Legacy grade', '10', 'Pristine 10']) {
        const record = { ...emptyGradingRecord(), provider: { kind: 'known' as const, id }, grade };
        assert.deepEqual(normalizeGradingRecord(record), record);
        gradingReviewNotes(record);
        assert.equal(record.label.variant, null);
      }
    }
    assert.ok(gradingReviewNotes({ ...emptyGradingRecord(), grade: '9.5' }).length);
    assert.deepEqual(
      gradingReviewNotes({ ...emptyGradingRecord(), provider: { kind: 'known', id: 'beckett' }, grade: '9.5' }),
      [],
    );
    assert.ok(
      gradingReviewNotes({ ...emptyGradingRecord(), provider: { kind: 'known', id: 'ace' }, grade: '9.5' }).length,
    );
  });

  test('duplicates use exact provider/certificate and current owner evidence, preserve independent copies', () => {
    const a = item(),
      b = item('synthetic-other'),
      foreign = { ...item('foreign-copy'), ownerUserId: 'different-owner' };
    const ace = {
      ...item('ace-copy'),
      grading: {
        ...emptyGradingRecord(),
        provider: { kind: 'known' as const, id: 'ace' as const },
        certificate: '00001234',
      },
    };
    assert.deepEqual(duplicateGradingCopies(a, a.grading, [a, b, foreign, ace]), [b.id]);
    assert.deepEqual(duplicateGradingCopies(a, { ...a.grading!, certificate: '1234' }, [a, b]), []);
    assert.deepEqual(duplicateGradingCopies(a, null, [a, b]), []);
    assert.deepEqual(duplicateGradingCopies(a, { ...a.grading!, certificate: null }, [a, b]), []);
    assert.deepEqual(duplicateGradingCopies(a, a.grading, []), []);
    assert.notEqual(a.id, b.id);
  });
});

describe('private official navigation without lookup or cookies', () => {
  test('verified PSA paths preserve zeros and discard session/prefetch/query/hash', () => {
    const parsed = parseOfficialGradingUrl('https://www.psacard.com/cert/00001234/psa?_rsc=discard#discard')!;
    assert.deepEqual(parsed, { provider: { kind: 'known', id: 'psa' }, certificate: '00001234' });
    assert.equal(
      privateGradingLink({ ...emptyGradingRecord(), ...parsed })?.href,
      'https://www.psacard.com/cert/00001234/psa',
    );
    assert.equal(parseOfficialGradingUrl('https://psacard.com/cert/000012345/psa/')?.certificate, '000012345');
  });
  test('unsafe, mismatched hosts, malformed and unverified paths fail closed', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://www.psacard.com/cert/00001234/psa',
      'https://www.psacard.com.evil.test/cert/00001234/psa',
      'https://evil.test@www.psacard.com/cert/00001234/psa',
      'https://www.psacard.com:443/cert/00001234/psa',
      'https://www.psacard.com/cert/%30%30%30%30%31%32%33%34/psa',
      'https://www.psacard.com/cert/00001234/../00001234/psa',
      'https://www.psacard.com/cert/123/psa',
      'https://www.psacard.com/cert/00001234/dna',
      'https://acegrading.com/cert/00001234',
      'https://www.cgccards.com/certlookup/00001234/',
      'https://beckett.com/grading/card-lookup?cert=00001234',
    ]) {
      assert.equal(parseOfficialGradingUrl(url), null, url);
    }
  });
  test('unverified certificate formats and providers use official lookup only; custom links never guessed', () => {
    for (const id of ['ace', 'cgc', 'beckett'] as const) {
      const link = privateGradingLink({
        ...emptyGradingRecord(),
        provider: { kind: 'known', id },
        certificate: '0000-PUNCTUATION',
      })!;
      assert.equal(link.kind, 'lookup');
      assert.ok(!link.href.includes('0000-PUNCTUATION'));
      assert.equal(new URL(link.href).protocol, 'https:');
    }
    assert.equal(privateGradingLink({ ...emptyGradingRecord(), certificate: '000-12' })?.kind, 'lookup');
    assert.equal(privateGradingLink(emptyGradingRecord()), null);
    assert.equal(
      privateGradingLink({
        ...emptyGradingRecord(),
        provider: { kind: 'custom', name: 'Synthetic' },
        certificate: '00001234',
      }),
      null,
    );
    assert.equal(privateGradingLink(null), null);
  });
});

// Preserve the existing safe projection. This does not make it an authenticated public serializer.
test('private certificate links and labels never enter existing browse serialization by default', () => {
  const snapshot = inventoryBrowseFixture();
  const graded = snapshot.items[1].grading!;
  graded.certificate = '00001234';
  graded.label.assetIds = ['synthetic-private-asset'];
  const index = buildInventoryBrowseIndex(
    { accountUserId: 'synthetic-owner', ownerUserId: snapshot.ownerUserId },
    { kind: 'cached', snapshot },
    [],
    [],
  );
  assert.equal(index.rows.length, 5);
  const serialized = JSON.stringify(index);
  for (const privateValue of [
    '00001234',
    'synthetic-private-asset',
    'SYNTHETIC-PRIVATE-HOLDER',
    'SYNTHETIC-PRIVATE-LABEL',
    'psacard.com/cert',
    '"certificate"',
    '"assetIds"',
  ]) {
    assert.ok(!serialized.includes(privateValue), privateValue);
  }
});
