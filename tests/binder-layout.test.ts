import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBinderGridSize,
  isPresetBinderLayout,
  needsCustomLayoutAccess,
  withBinderLayout,
} from '../lib/binder-layout';
import { getDefaultBinderSettings, normalizeBinderSettings } from '../lib/settings';
import { normalizeBinderDesign } from '../lib/binder-design';

test('custom layouts accept integer dimensions through 8 and reject invalid input', () => {
  for (const value of [1, 4, 8]) assert.equal(isBinderGridSize(value), true);
  for (const value of [0, -1, 9, 2.5, NaN, Infinity, '8', null]) assert.equal(isBinderGridSize(value), false);
  assert.equal(normalizeBinderSettings({ binderRows: 8, binderCols: 7 }, getDefaultBinderSettings()).binderRows, 8);
  assert.equal(normalizeBinderSettings({ binderRows: 2.5, binderCols: 999 }, getDefaultBinderSettings()).binderRows, 4);
  assert.equal(normalizeBinderSettings({ binderRows: 2.5, binderCols: 999 }, getDefaultBinderSettings()).binderCols, 4);
  assert.equal(normalizeBinderDesign({ rows: 8, cols: 7 }).rows, 8);
  assert.equal(normalizeBinderDesign({ rows: 8, cols: 7 }).cols, 7);
});

test('only the six existing presets are free; retained layouts can still be saved after expiry', () => {
  for (const [rows, cols] of [
    [1, 1],
    [2, 2],
    [3, 3],
    [3, 4],
    [4, 3],
    [4, 4],
  ]) {
    assert.equal(isPresetBinderLayout(rows, cols), true);
    assert.equal(needsCustomLayoutAccess({ rows, cols }, null), false);
  }
  assert.equal(needsCustomLayoutAccess({ rows: 8, cols: 8 }, null), true);
  assert.equal(needsCustomLayoutAccess({ rows: 2, cols: 3 }, null), true);
  assert.equal(needsCustomLayoutAccess({ rows: 8, cols: 8 }, { rows: 8, cols: 8 }), false);
  assert.equal(needsCustomLayoutAccess({ rows: 8, cols: 7 }, { rows: 8, cols: 8 }), true);
});

test('binder dimensions override account defaults without changing other settings', () => {
  const settings = getDefaultBinderSettings();
  assert.deepEqual(withBinderLayout(settings, { rows: 8, cols: 6 }), { ...settings, binderRows: 8, binderCols: 6 });
  assert.deepEqual(withBinderLayout(settings, { rows: null, cols: null }), settings);
  assert.deepEqual(withBinderLayout(settings, { rows: 999, cols: 2.5 }), settings);
  assert.equal(settings.binderRows, 4);
});
