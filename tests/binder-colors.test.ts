import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BINDER_COLOR_PRESETS,
  DEFAULT_BINDER_COLOR_ID,
  getBinderColorPreset,
  normalizeBinderColor,
  type BinderColorId,
} from '../lib/binder-colors';

const ALL_IDS: BinderColorId[] = [
  'emerald',
  'ocean',
  'ruby',
  'violet',
  'amber',
  'slate',
  'black',
  'white',
  'transparent',
];

test('every binder colour id has exactly one preset', () => {
  assert.deepEqual(BINDER_COLOR_PRESETS.map((preset) => preset.id).sort(), [...ALL_IDS].sort());
});

test('each preset defines a full dark and light theme and a two-stop swatch', () => {
  for (const preset of BINDER_COLOR_PRESETS) {
    assert.ok(preset.label.length > 0, `${preset.id} label`);
    assert.equal(preset.swatch.length, 2);
    for (const theme of [preset.dark, preset.light]) {
      for (const key of ['background', 'border', 'activeOutline', 'shadow', 'gloss'] as const) {
        assert.equal(typeof theme[key], 'string', `${preset.id}.${key}`);
        assert.ok(theme[key].length > 0, `${preset.id}.${key}`);
      }
    }
  }
});

test('getBinderColorPreset finds presets and falls back to the configured default preset', () => {
  for (const id of ALL_IDS) {
    assert.equal(getBinderColorPreset(id).id, id);
  }
  assert.equal(DEFAULT_BINDER_COLOR_ID, 'black');
  assert.equal(getBinderColorPreset(null).id, DEFAULT_BINDER_COLOR_ID);
  assert.equal(getBinderColorPreset(undefined).id, DEFAULT_BINDER_COLOR_ID);
  assert.equal(getBinderColorPreset('nope' as BinderColorId).id, DEFAULT_BINDER_COLOR_ID);
});

test('custom hex colours get a generated theme of plain hex colours', () => {
  const preset = getBinderColorPreset('#1C6B43');
  assert.equal(preset.id, '#1c6b43');
  assert.equal(preset.swatch[0], '#1c6b43');
  assert.match(preset.swatch[1], /^#[0-9a-f]{6}$/);
  assert.match(preset.dark.border, /^#[0-9a-f]{6}$/);
  assert.ok(preset.dark.background.includes('#1c6b43'));
  assert.equal(getBinderColorPreset('#12345').id, DEFAULT_BINDER_COLOR_ID);
});

test('normalizeBinderColor keeps presets and valid hex, drops anything else', () => {
  assert.equal(normalizeBinderColor('ruby'), 'ruby');
  assert.equal(normalizeBinderColor('#ABCDEF'), '#abcdef');
  assert.equal(normalizeBinderColor('#abc'), undefined);
  assert.equal(normalizeBinderColor('red'), undefined);
  assert.equal(normalizeBinderColor(42), undefined);
});
