import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cardTilt, MAX_CARD_TILT } from '@/lib/card-tilt';

const rect = { left: 100, top: 200, width: 300, height: 400 };

describe('cardTilt', () => {
  test('is flat with the shine centred at the middle', () => {
    assert.deepEqual(cardTilt(250, 400, rect), { rotateX: 0, rotateY: 0, shineX: 50, shineY: 50 });
  });

  test('top-right corner leans the top and right edges back by the max tilt', () => {
    assert.deepEqual(cardTilt(400, 200, rect), {
      rotateX: MAX_CARD_TILT,
      rotateY: MAX_CARD_TILT,
      shineX: 100,
      shineY: 0,
    });
  });

  test('clamps a pointer outside the card and tolerates an empty rect', () => {
    assert.deepEqual(cardTilt(-500, 5000, rect), {
      rotateX: -MAX_CARD_TILT,
      rotateY: -MAX_CARD_TILT,
      shineX: 0,
      shineY: 100,
    });
    assert.equal(cardTilt(10, 10, { left: 0, top: 0, width: 0, height: 0 }).rotateY, 0);
  });
});
