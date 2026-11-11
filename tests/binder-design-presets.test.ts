import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_SURFACES, defaultBinderDesign, isCardArtworkUrl, normalizeBinderDesign } from '../lib/binder-design';
import { BINDER_DESIGN_PRESETS, applyBinderDesignPreset } from '../lib/binder-design-presets';

test('presets preserve the collection structure, personal lettering and page overrides', () => {
  const original = defaultBinderDesign();
  original.name = 'My favourites';
  original.pageCount = 73;
  original.rows = 3;
  original.cols = 4;
  original.stats = 'full';
  original.pageColors = { '1': '#aa1122', '50': '#2233aa' };
  for (const surface of DESIGN_SURFACES) original.surfaces[surface].words = `My ${surface}`;
  original.surfaces.cover.artwork = 'upload:personal-cover';
  original.surfaces.cover.frame = { fit: 'fit', zoom: 2, x: 0.5, y: -0.5 };
  const before = structuredClone(original);
  for (const preset of BINDER_DESIGN_PRESETS) {
    const result = applyBinderDesignPreset(original, preset.id);
    for (const key of ['name', 'pageCount', 'rows', 'cols', 'stats', 'pageColors'] as const)
      assert.deepEqual(result[key], original[key]);
    for (const surface of DESIGN_SURFACES) {
      assert.equal(result.surfaces[surface].words, original.surfaces[surface].words);
      assert.notEqual(result.surfaces[surface], original.surfaces[surface]);
      assert.notEqual(result.surfaces[surface].frame, original.surfaces[surface].frame);
    }
    assert.notEqual(result.pageColors, original.pageColors);
    assert.deepEqual(original, before);
  }
});

test('all coordinated appearances normalize unchanged and only use mirrored card artwork', () => {
  assert.equal(BINDER_DESIGN_PRESETS.length, 6);
  assert.equal(new Set(BINDER_DESIGN_PRESETS.map((preset) => preset.id)).size, 6);
  const covers = new Set<string>();
  for (const preset of BINDER_DESIGN_PRESETS) {
    const result = applyBinderDesignPreset(defaultBinderDesign(), preset.id);
    assert.deepEqual(normalizeBinderDesign(result), result);
    assert.equal(preset.swatches[0], result.surfaces.cover.color);
    covers.add(result.surfaces.cover.color);
    for (const surface of DESIGN_SURFACES) {
      const artwork = result.surfaces[surface].artwork;
      if (artwork) assert.equal(isCardArtworkUrl(artwork), true);
    }
  }
  assert.equal(covers.size, 6);
  assert.ok(applyBinderDesignPreset(defaultBinderDesign(), 'magikarp').surfaces.cover.artwork);
  assert.ok(applyBinderDesignPreset(defaultBinderDesign(), 'mew').surfaces.cover.artwork);
});

test('changing presets replaces appearance but leaves the prior artwork available to Undo', () => {
  const uploaded = defaultBinderDesign();
  uploaded.surfaces.cover.artwork = 'upload:my-artwork';
  const illustrated = applyBinderDesignPreset(uploaded, 'magikarp');
  assert.notEqual(illustrated.surfaces.cover.artwork, uploaded.surfaces.cover.artwork);
  const plain = applyBinderDesignPreset(illustrated, 'ivory');
  for (const surface of DESIGN_SURFACES) assert.equal(plain.surfaces[surface].artwork, null);
  assert.equal(uploaded.surfaces.cover.artwork, 'upload:my-artwork');
  assert.ok(illustrated.surfaces.cover.artwork);
  assert.equal(applyBinderDesignPreset(uploaded, 'unknown'), uploaded);
});
