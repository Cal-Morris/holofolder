import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binderPreviewSummary } from '../lib/binder-share-preview';
import type { PublicDisplaySlot } from '../lib/public-binder';

// Synthetic slots, not real binder data.
const slot = (id: string, image: string | null, owned: boolean): PublicDisplaySlot => ({
  id,
  target: { kind: 'card' },
  item: owned ? { grading: null } : null,
  card: image ? { name: id, image } : null,
  pokemon: null,
});

test('preview counts targets and keeps only https images', () => {
  const summary = binderPreviewSummary({
    rows: 1,
    cols: 5,
    slots: [
      slot('a', 'https://example.test/a.jpg', false),
      slot('b', 'https://example.test/b.jpg', true),
      slot('c', null, true),
      slot('d', 'data:image/png;base64,AAAA', true),
      { ...slot('spacer', null, false), target: null },
    ],
  });
  assert.equal(summary.collected, 3);
  assert.equal(summary.total, 4);
  assert.deepEqual(
    summary.page.map((p) => p.src),
    ['https://example.test/a.jpg', 'https://example.test/b.jpg', null, null, null],
  );
});

test('preview shows the page with the most owned cards, padded to a full page', () => {
  const slots = [
    slot('p1-owned', 'https://example.test/1.jpg', true),
    slot('p1-want', 'https://example.test/2.jpg', false),
    slot('p2-owned', 'https://example.test/3.jpg', true),
    slot('p2-owned-too', 'https://example.test/4.jpg', true),
    slot('p3-owned', 'https://example.test/5.jpg', true),
  ];
  const { page } = binderPreviewSummary({ rows: 1, cols: 2, slots });
  assert.deepEqual(
    page.map((p) => p.src),
    ['https://example.test/3.jpg', 'https://example.test/4.jpg'],
  );
  assert.equal(binderPreviewSummary({ rows: 1, cols: 2, slots: slots.slice(4) }).page[1].src, null);
});
