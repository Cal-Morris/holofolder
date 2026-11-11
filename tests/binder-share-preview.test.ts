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

test('preview counts targets, puts owned cards first and keeps only http images', () => {
  const summary = binderPreviewSummary(
    {
      slots: [
        slot('a', 'https://example.test/a.jpg', false),
        slot('b', 'https://example.test/b.jpg', true),
        slot('c', null, true),
        slot('d', 'data:image/png;base64,AAAA', true),
        { ...slot('spacer', null, false), target: null },
      ],
    },
    5,
  );
  assert.deepEqual(summary, {
    collected: 3,
    total: 4,
    images: ['https://example.test/b.jpg', 'https://example.test/a.jpg'],
  });
});

test('preview caps the card row', () => {
  const slots = Array.from({ length: 9 }, (_, i) => slot(String(i), `https://example.test/${i}.jpg`, true));
  assert.equal(binderPreviewSummary({ slots }, 5).images.length, 5);
});
