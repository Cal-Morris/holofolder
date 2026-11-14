import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CubicBezierCurve3, PerspectiveCamera, Vector3 } from 'three';
import { binderCameraFrame } from '../lib/binder-camera';
import { binderPage, type BinderView } from '../lib/binder-design';

test('fits the full binder on short previews, portrait phones and desktop', () => {
  for (const view of ['front', 'back', 'spine', 'inside', 'detail'] as BinderView[]) {
    for (const [width, height] of [
      [351, 174],
      [351, 480],
      [852, 626],
    ]) {
      for (const [depth, page] of [0.15, 2].flatMap((d) =>
        [binderPage(3, 3), binderPage(2, 6), binderPage(4, 4)].map((p) => [d, p] as const),
      )) {
        const frame = binderCameraFrame(view, width, height, depth, page),
          half = page.coverWidth / 2,
          top = page.coverHeight / 2 + 0.07;
        const camera = new PerspectiveCamera(34, width / height, 0.1, 100);
        camera.position.set(...frame.position);
        camera.lookAt(...frame.target);
        camera.updateMatrixWorld();
        if (view !== 'inside') {
          const binding = new CubicBezierCurve3(
            new Vector3(-half, 0, -depth),
            new Vector3(-half - depth, 0, -depth),
            new Vector3(-half - depth, 0, depth),
            new Vector3(-half, 0, depth),
          );
          for (const point of binding.getPoints(100)) {
            point.project(camera);
            assert.ok(Math.abs(point.x) <= 0.91 && Math.abs(point.y) <= 0.91, `${view}: curved spine clipped`);
          }
        }
        for (const x of view === 'inside' ? [-3 * half - 0.2, half + 0.2] : [-half - 0.3, half + 0.3]) {
          for (const y of [-top, top]) {
            for (const z of [-depth - 0.1, depth + 0.1]) {
              const point = new Vector3(x, y, z).project(camera);
              assert.ok(Math.abs(point.x) <= 0.91, `${view}: horizontal edge clipped`);
              assert.ok(Math.abs(point.y) <= 0.91, `${view}: vertical edge clipped`);
            }
          }
        }
      }
    }
  }
});

test('uses the preview space and stays finite before the stage has a size', () => {
  const frame = binderCameraFrame('inside', 351, 174, 0.15, binderPage(3, 3));
  assert.ok(Math.hypot(frame.position[1], frame.position[2]) < 8);
  const zero = binderCameraFrame('front', 0, 0, 0.15, binderPage(3, 3));
  assert.ok(zero.position.every(Number.isFinite));
});
