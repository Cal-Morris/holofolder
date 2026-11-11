import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryExplanation } from '../lib/domain/activity-recovery';
test('recovery explains why an undo is unavailable', () => {
  assert.match(recoveryExplanation('card_changed'), /newer edit/);
});
