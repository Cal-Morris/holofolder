import type { BinderPage, BinderView } from '@/lib/binder-design';

type Point = [number, number, number];
const directions: Record<BinderView, Point> = {
  front: [-0.33, 0.16, 1],
  back: [0.1, 0.1, -1],
  spine: [-1, 0.1, 0.1],
  inside: [0, 0.22, 1],
  detail: [1, 0.2, 1],
};

/** Fit the binder's envelope with space around every edge, including the zipper. */
export function binderCameraFrame(
  view: BinderView,
  width: number,
  height: number,
  coverDepth: number,
  page: Pick<BinderPage, 'coverWidth' | 'coverHeight'>,
): { position: Point; target: Point } {
  const direction = directions[view],
    length = Math.hypot(...direction);
  const [dx, dy, dz] = direction.map((value) => value / length);
  const horizontal = Math.hypot(dx, dz);
  const right: Point = [dz / horizontal, 0, -dx / horizontal];
  const up: Point = [(-dy * dx) / horizontal, horizontal, (-dy * dz) / horizontal];
  const half = page.coverWidth / 2,
    top = page.coverHeight / 2 + 0.07;
  const left = view === 'inside' ? -half - page.coverWidth - 0.2 : Math.min(-half - 0.3, -half - 0.75 * coverDepth);
  const rightEdge = view === 'inside' ? half + 0.2 : half + 0.3;
  const target: Point = [(left + rightEdge) / 2, 0, 0];
  const tangent = Math.tan((17 * Math.PI) / 180),
    aspect = Math.max(1, width) / Math.max(1, height);
  let distance = 2;
  for (const x of [left, rightEdge]) {
    for (const y of [-top, top]) {
      for (const z of [-coverDepth - 0.1, coverDepth + 0.1]) {
        const px = x - target[0];
        const depth = px * dx + y * dy + z * dz;
        const horizontalSize = Math.abs(px * right[0] + z * right[2]);
        const verticalSize = Math.abs(px * up[0] + y * up[1] + z * up[2]);
        distance = Math.max(
          distance,
          depth + 1.12 * Math.max(horizontalSize / (tangent * aspect), verticalSize / tangent),
        );
      }
    }
  }
  return { position: [target[0] + dx * distance, dy * distance, dz * distance], target };
}
