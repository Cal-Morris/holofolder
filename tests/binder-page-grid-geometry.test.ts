import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBinderGridAspectRatio,
  getBinderSlotBoundaryOffsets,
  getBlankRegionEdgeFloor,
} from '../lib/binder-page-scan';

test('getBinderGridAspectRatio uses card slot proportions instead of a square row-column ratio', () => {
  assert.equal(getBinderGridAspectRatio(4, 4), 2.5 / 3.5);
  assert.ok(Math.abs(getBinderGridAspectRatio(3, 4) - (4 * 2.5) / (3 * 3.5)) < 1e-12);
});

test('getBinderSlotBoundaryOffsets returns ordered start and end offsets for each slot', () => {
  const offsets = getBinderSlotBoundaryOffsets(400, 4, 0.05);

  assert.equal(offsets.length, 8);
  assert.deepEqual(offsets.map(Math.round), [0, 95, 102, 197, 203, 298, 305, 400]);
});

test('getBinderSlotBoundaryOffsets keeps a single slot as the full span', () => {
  assert.deepEqual(getBinderSlotBoundaryOffsets(250, 1, 0.05), [0, 250]);
});

test('getBlankRegionEdgeFloor lowers the blank-region floor for soft photos only', () => {
  // Measured mean edge strengths of real page photos: the six soft ones that found no grid sat at 5.0-6.9.
  assert.ok(getBlankRegionEdgeFloor(5) < 5, 'a soft page must not be treated as blank everywhere');
  assert.equal(getBlankRegionEdgeFloor(15), 8, 'sharp photos keep the original floor');
  assert.equal(getBlankRegionEdgeFloor(40), 8);
});
