import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyMoveDragsSheet,
  dismissDuration,
  dragOffset,
  dragDistanceForOffset,
  MAX_OVERDRAG,
  releaseVelocity,
  shouldDismissDrag,
} from '../lib/sheet-drag';

describe('sheet drag', () => {
  it('measures velocity over the last stretch of the gesture only', () => {
    const samples = [
      { y: 0, time: 0 },
      { y: 2, time: 200 },
      { y: 22, time: 240 },
      { y: 62, time: 280 },
    ];
    assert.equal(releaseVelocity(samples), 0.75);
    assert.equal(releaseVelocity(samples, 280 + 200), 0, 'a finger that paused before lifting has no fling');
    assert.equal(releaseVelocity([{ y: 10, time: 5 }]), 0);
  });

  it('rubber-bands upward drags and never exceeds the cap', () => {
    assert.equal(dragOffset(40), 40);
    assert.ok(dragOffset(-10) < 0 && dragOffset(-10) > -10);
    assert.ok(dragOffset(-10_000) > -MAX_OVERDRAG);
  });

  it('resumes from the visible position when catching a sheet', () => {
    for (const distance of [-300, -50, -1, 0, 50, 300]) {
      const recovered = dragDistanceForOffset(dragOffset(distance));
      assert.ok(Math.abs(recovered - distance) < 0.0001);
      assert.ok(Math.abs(dragOffset(recovered + 10) - dragOffset(distance + 10)) < 0.0001);
    }
  });

  it('dismisses on distance, fling, or projected position', () => {
    assert.equal(shouldDismissDrag(90, 0), true);
    assert.equal(shouldDismissDrag(30, 0.6), true);
    assert.equal(shouldDismissDrag(30, 0.1), false);
    assert.equal(shouldDismissDrag(60, 0.3, 300), true);
    assert.equal(shouldDismissDrag(60, 0.05, 600), false);
    assert.equal(shouldDismissDrag(120, -0.4), false, 'flicking back up cancels');
    assert.equal(shouldDismissDrag(-20, 2), false);
  });

  it('keeps exit animations short', () => {
    assert.equal(dismissDuration(600, 5), 120);
    assert.equal(dismissDuration(600, 0), 240);
  });

  it('lets a body drag move the sheet only when pulling down from the top', () => {
    assert.equal(bodyMoveDragsSheet(0, 6, 0), true);
    assert.equal(bodyMoveDragsSheet(-3, 3, 0), true, 'a diagonal still counts as down');
    assert.equal(bodyMoveDragsSheet(0, 6, 40), false, 'a scrolled body scrolls back up first');
    assert.equal(bodyMoveDragsSheet(0, -6, 0), false, 'pushing up scrolls the body');
    assert.equal(bodyMoveDragsSheet(8, 4, 0), false, 'a sideways move belongs to carousels');
    assert.equal(bodyMoveDragsSheet(0, 0, 0), false);
  });
});
