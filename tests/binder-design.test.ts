import { createBinderTapTracker } from '../lib/binder-pointer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  artworkRectangle,
  binderDimensions,
  binderSpread,
  binderTurnPage,
  binderPocket,
  binderPage,
  pageTurnPoint,
  binderFill,
  cardTextureSources,
  defaultBinderDesign,
  isCardArtworkUrl,
  normalizeBinderDesign,
} from '../lib/binder-design';
import { getDefaultBinderSettings } from '../lib/settings';
import { saveBinderDesign, validateArtwork } from '../lib/binder-design-storage';
test('depth grows with pages and preserves current National Dex layout', () => {
  assert.equal(defaultBinderDesign(getDefaultBinderSettings()).pageCount, 65);
  assert.ok(binderDimensions(60).depth > binderDimensions(20).depth);
  const d = normalizeBinderDesign({
    ...defaultBinderDesign(),
    rows: 1,
    cols: 1,
    pageCount: 1025,
    pageColors: { 120: '#112233' },
  });
  assert.equal(d.rows, 1);
  assert.equal(d.pageCount, 1025);
  assert.equal(d.pageColors[120], '#112233');
});
test('framing can reach the full zoomed artwork and handles fit', () => {
  const left = artworkRectangle(400, 100, 100, 100, { fit: 'fill', zoom: 4, x: -1, y: 0 });
  const right = artworkRectangle(400, 100, 100, 100, { fit: 'fill', zoom: 4, x: 1, y: 0 });
  assert.ok(left.x + left.width <= 100);
  assert.ok(right.x >= 0);
  assert.deepEqual(artworkRectangle(400, 100, 100, 100, { fit: 'fit', zoom: 1, x: 0, y: 0 }), {
    x: 0,
    y: 37.5,
    width: 100,
    height: 25,
  });
});
test('untrusted artwork cannot request arbitrary hosts or persist blob URLs', () => {
  const allowed =
    '/app/api/card-image-proxy?url=' + encodeURIComponent('https://assets.tcgdex.net/en/sv/sv03.5/166/high.webp');
  assert.equal(isCardArtworkUrl(allowed), true);
  for (const value of [
    'https://attacker.example/a',
    '/app/api/card-image-proxy?url=https://evil.example/a',
    'blob:wrong',
    'data:image/svg+xml,x',
  ]) {
    assert.equal(isCardArtworkUrl(value), false);
    const d = defaultBinderDesign();
    d.surfaces.cover.artwork = value;
    assert.equal(normalizeBinderDesign(d).surfaces.cover.artwork, null);
  }
});
test('invalid uploads and missing saved artwork fail without overwriting', async () => {
  await assert.rejects(validateArtwork(new File(['bad'], 'test.svg', { type: 'image/svg+xml' })), /PNG/);
  const d = defaultBinderDesign();
  d.surfaces.cover.artwork = 'upload:missing';
  await assert.rejects(saveBinderDesign('test', d, {}), /missing/);
});
test('device storage failure rejects saving without mutating the draft', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'),
    d = defaultBinderDesign(),
    before = structuredClone(d);
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open() {
        throw new Error('Synthetic unavailable storage');
      },
    },
  });
  try {
    await assert.rejects(saveBinderDesign('owner:test', d, {}), /unavailable storage/);
    assert.deepEqual(d, before);
  } finally {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});

test('existing app page colours retain their one-based page keys', () => {
  const settings = getDefaultBinderSettings();
  settings.binderPageColors = { '1': 'ruby', '2': 'emerald' };
  const design = defaultBinderDesign(settings);
  assert.equal(design.pageColors['1'], '#b83252');
  assert.equal(design.pageColors['2'], '#1c6b43');
  assert.equal(normalizeBinderDesign(design).pageColors['1'], '#b83252');
});

test('preview fill only counts occupied slots within configured capacity', () => {
  assert.equal(
    binderFill(
      Array.from({ length: 100 }, (_, i) => i),
      9,
    ),
    100,
  );
  assert.equal(binderFill([9, 10, 11], 9), 0);
  assert.equal(binderFill([0, 0, 1, 100], 9), 22);
});

test('two page faces share a thin physical leaf and preserve odd final face', () => {
  assert.equal(binderDimensions(65).leaves, 33);
  assert.equal(binderDimensions(2).stack, binderDimensions(1).stack);
  assert.equal(binderDimensions(66).stack, binderDimensions(65).stack);
  assert.ok(binderDimensions(66).stack < 0.3);
  assert.deepEqual(binderSpread(1, 5), { selected: 1, turnedLeaves: 0, left: 0, right: 1 });
  assert.deepEqual(binderSpread(2, 5), { selected: 2, turnedLeaves: 1, left: 2, right: 3 });
  assert.deepEqual(binderSpread(3, 5), { selected: 3, turnedLeaves: 1, left: 2, right: 3 });
  assert.deepEqual(binderSpread(6, 6), { selected: 6, turnedLeaves: 3, left: 6, right: 0 });
});
test('turn flex keeps the hinge attached and lands front and back on opposite sides', () => {
  const width = 2.25;
  assert.deepEqual(pageTurnPoint(0, 0, width, 0.5), { x: 0, z: 0 });
  assert.deepEqual(pageTurnPoint(width, 0, width, 0), { x: width, z: 0 });
  const mid = pageTurnPoint(width, 0, width, 0.5),
    end = pageTurnPoint(width, 0.003, width, 1);
  assert.ok(mid.z > 2);
  assert.ok(Math.abs(end.x + width) < 0.00001);
  assert.ok(Math.abs(end.z + 0.003) < 0.00001);
});

test('clicking either side advances complete spreads without skipping the final back face', () => {
  assert.equal(binderTurnPage(1, 6, 1), 2);
  assert.equal(binderTurnPage(2, 6, 1), 4);
  assert.equal(binderTurnPage(3, 6, 1), 4);
  assert.equal(binderTurnPage(5, 6, 1), 6);
  assert.equal(binderTurnPage(4, 6, -1), 2);
  assert.equal(binderTurnPage(2, 6, -1), 1);
});
test('page turns stay on the first or final spread including odd and single faces', () => {
  assert.equal(binderTurnPage(1, 5, -1), 1);
  assert.equal(binderTurnPage(5, 5, 1), 5);
  assert.equal(binderTurnPage(4, 5, 1), 4);
  assert.equal(binderTurnPage(6, 6, 1), 6);
  assert.equal(binderTurnPage(1, 1, 1), 1);
});

test('page taps reject returning drags, multi-touch and cancelled gestures', () => {
  const tap = createBinderTapTracker(),
    first = { pointerId: 1, clientX: 20, clientY: 20 },
    second = { pointerId: 2, clientX: 20, clientY: 20 };
  tap.down(first);
  tap.move({ ...first, clientX: 40 });
  tap.move(first);
  assert.equal(tap.up(first), false);
  tap.down(first);
  tap.down(second);
  assert.equal(tap.up(first), false);
  assert.equal(tap.up(second), false);
  tap.down(first);
  tap.cancel(first);
  assert.equal(tap.up(first), false);
  tap.down(first);
  assert.equal(tap.up({ ...first, clientX: 23 }), true);
});

test('page taps read native pointer fields from inherited getters', () => {
  const tap = createBinderTapTracker();
  const event = Object.create({
    get pointerId() {
      return 7;
    },
    get clientX() {
      return 12;
    },
    get clientY() {
      return 24;
    },
  }) as { pointerId: number; clientX: number; clientY: number };
  assert.equal(Object.keys(event).length, 0);
  tap.down(event);
  assert.equal(tap.up(event), true);
  tap.down(event);
  tap.move({ pointerId: 7, clientX: 32, clientY: 24 });
  assert.equal(tap.up(event), false);
});

test('pockets and cards stay inside both mirrored cover footprints through a leaf turn', () => {
  for (const [rows, cols] of [
    [3, 3],
    [4, 4],
    [2, 3],
    [2, 6],
  ]) {
    const page = binderPage(rows, cols),
      width = page.width + page.inset;
    for (let i = 0; i < rows * cols; i++) {
      const front = binderPocket(rows, cols, i, 1),
        back = binderPocket(rows, cols, i, -1);
      const cardWidth = Math.min(front.w * 0.92, (front.h * 0.92 * 63) / 88);
      for (const [p, progress] of [
        [front, 0],
        [back, 1],
      ] as const) {
        const centre = page.hingeX + pageTurnPoint(p.x, 0, width, progress).x;
        const min = progress === 0 ? page.hingeX : page.hingeX - page.coverWidth,
          max = progress === 0 ? -page.hingeX : page.hingeX;
        assert.ok(centre - p.w * 0.47 > min && centre + p.w * 0.47 < max);
        assert.ok(cardWidth / 2 < p.w * 0.47);
        assert.ok(Math.abs(p.y) + p.h / 2 < page.height / 2);
      }
      assert.ok(Math.abs(front.y - back.y) < 1e-9);
      assert.ok(Math.abs(front.x + back.x - (page.width + 2 * page.inset)) < 1e-9);
    }
  }
});

test('3x3 keeps the original footprint and pockets stay card shaped for every layout', () => {
  assert.deepEqual(
    Object.values(binderPage(3, 3)).map((v) => Math.round(v * 1000) / 1000),
    [-1.3, 0.23, 2.25, 3.13, 2.6, 3.5],
  );
  for (const [rows, cols] of [
    [1, 1],
    [2, 6],
    [4, 4],
  ]) {
    const { w, h } = binderPocket(rows, cols, 0, 1);
    assert.ok(Math.abs(w / h - 63 / 88) < 0.01);
  }
});

test('3D card textures use the public asset with a proxy fallback and drop anything that would taint WebGL', () => {
  assert.deepEqual(cardTextureSources('https://assets.tcgdex.net/en/base/base1/44/high.webp'), {
    image: 'https://assets.holofolder.com/pokemon/tcg/cards/en/base1/44/high.webp',
    fallback: `/app/api/card-image-proxy?url=${encodeURIComponent('https://assets.tcgdex.net/en/base/base1/44/high.webp')}`,
  });
  assert.deepEqual(cardTextureSources('https://example.com/card.png'), { image: '' });
  assert.deepEqual(cardTextureSources(undefined), { image: '' });
});
