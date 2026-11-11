import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsFingerprint } from '../lib/developer-api/settings';
test('settings snapshots include raw preferences and the selected binder layout with stable key ordering', () => {
  const row = { dark_mode: false, binder_color_id: 'synthetic' };
  assert.equal(
    settingsFingerprint(row, { binder_rows: 3, binder_cols: 3 }),
    settingsFingerprint({ binder_color_id: 'synthetic', dark_mode: false }, { binder_cols: 3, binder_rows: 3 }),
  );
  assert.notEqual(settingsFingerprint(row, null), settingsFingerprint({ ...row, dark_mode: true }, null));
  assert.notEqual(
    settingsFingerprint(row, { binder_rows: 3, binder_cols: 3 }),
    settingsFingerprint(row, { binder_rows: 4, binder_cols: 3 }),
  );
  assert.notEqual(settingsFingerprint(null, null), settingsFingerprint(row, null));
});
