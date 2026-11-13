import test from 'node:test';
import assert from 'node:assert/strict';
import { readOfflineShellState } from '../lib/offline-shell';

function storage(entries: Record<string, unknown>) {
  return {
    getItem: (key: string) =>
      key in entries
        ? typeof entries[key] === 'string'
          ? (entries[key] as string)
          : JSON.stringify(entries[key])
        : null,
  };
}

test("boots the signed-in user's settings with no legacy rows", () => {
  const state = readOfflineShellState(
    storage({ 'pokemon_binder_settings:u1': { binderRows: 3, binderCols: 3, darkMode: false } }),
    '',
    'u1',
  );
  assert.deepEqual(state.collection, []);
  assert.equal(state.collectionOwnerUserId, 'u1');
  assert.equal(state.settings.binderRows, 3);
  assert.equal(state.darkMode, false);
});

test('ignores corrupt storage and falls back to defaults', () => {
  const state = readOfflineShellState(storage({ 'pokemon_binder_settings:u1': 'nope' }), '', 'u1');
  assert.equal(state.settings.binderRows, 4);
  assert.equal(state.darkMode, true);
});

test('signed out: anonymous settings apply and the theme cookie wins', () => {
  const state = readOfflineShellState(
    storage({ 'pokemon_binder_settings:anon': { binderRows: 5, darkMode: true } }),
    'a=1; binderdex_theme=light',
    null,
  );
  assert.deepEqual(state.collection, []);
  assert.equal(state.collectionOwnerUserId, null);
  assert.equal(state.settings.binderRows, 5);
  assert.equal(state.darkMode, false);
});
