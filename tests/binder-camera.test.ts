import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CubicBezierCurve3, PerspectiveCamera, Vector3 } from 'three';
import { binderCameraFrame } from '../lib/binder-camera';
import type { BinderView } from '../lib/binder-design';

test('fits the full binder on short previews, portrait phones and desktop', () => {
  for (const view of ['front', 'back', 'spine', 'inside', 'detail'] as BinderView[]) {
    for (const [width, height] of [
      [351, 174],
      [351, 480],
      [852, 626],
    ]) {
      for (const depth of [0.15, 2]) {
        const frame = binderCameraFrame(view, width, height, depth);
        const camera = new PerspectiveCamera(34, width / height, 0.1, 100);
        camera.position.set(...frame.position);
        camera.lookAt(...frame.target);
        camera.updateMatrixWorld();
        if (view !== 'inside') {
          const binding = new CubicBezierCurve3(
            new Vector3(-1.3, 0, -depth),
            new Vector3(-1.3 - depth, 0, -depth),
            new Vector3(-1.3 - depth, 0, depth),
            new Vector3(-1.3, 0, depth),
          );
          for (const point of binding.getPoints(100)) {
            point.project(camera);
            assert.ok(Math.abs(point.x) <= 0.91 && Math.abs(point.y) <= 0.91, `${view}: curved spine clipped`);
          }
        }
        for (const x of view === 'inside' ? [-4.1, 1.5] : [-1.6, 1.6]) {
          for (const y of [-1.82, 1.82]) {
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
  const frame = binderCameraFrame('inside', 351, 174, 0.15);
  assert.ok(Math.hypot(frame.position[1], frame.position[2]) < 8);
  const zero = binderCameraFrame('front', 0, 0, 0.15);
  assert.ok(zero.position.every(Number.isFinite));
});
