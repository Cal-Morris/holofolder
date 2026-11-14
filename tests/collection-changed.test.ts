import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { mergePingRevision, pingCovered, pingRevision } from '@/lib/collection/collection-changed';

describe('collection_changed ping', () => {
  test('reads the revision only when it is a safe non-negative integer', () => {
    assert.equal(pingRevision({ revision: 7 }), 7);
    assert.equal(pingRevision({ revision: null }), null);
    assert.equal(pingRevision({}), null);
    assert.equal(pingRevision(undefined), null);
    assert.equal(pingRevision({ revision: '7' }), null);
    assert.equal(pingRevision({ revision: 1.5 }), null);
    assert.equal(pingRevision({ revision: -1 }), null);
  });

  test('a burst keeps the highest revision, and any ping without one forces a read', () => {
    assert.equal(mergePingRevision(undefined, 3), 3);
    assert.equal(mergePingRevision(5, 3), 5);
    assert.equal(mergePingRevision(3, 5), 5);
    assert.equal(mergePingRevision(5, null), null);
    assert.equal(mergePingRevision(null, 5), null);
  });

  test('skips only when the read or an acknowledged edit already reaches the revision', () => {
    assert.equal(pingCovered(5, 5, []), true);
    assert.equal(pingCovered(5, 6, []), true);
    assert.equal(pingCovered(5, 4, []), false);
    assert.equal(pingCovered(5, 4, [5]), true);
    assert.equal(pingCovered(5, null, [4]), false);
    assert.equal(pingCovered(null, 99, [99]), false);
  });
});
