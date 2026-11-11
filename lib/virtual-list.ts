/**
 * Windowing for long lists with rows of slightly different heights: only the rows near the viewport are
 * rendered, and the rest of the scroll height is reserved. Heights come from measured rows, falling back to
 * an estimate (the average of what has been measured) for rows not yet rendered.
 */
export interface VirtualRange {
  /** First rendered index (inclusive). */
  start: number;
  /** Last rendered index (exclusive). */
  end: number;
  /** Distance from the top of the list to the first rendered row. */
  offsetTop: number;
  /** Height of the whole list, including the gaps between rows. */
  totalHeight: number;
}

export interface VirtualRangeInput {
  count: number;
  getHeight: (index: number) => number;
  gap: number;
  scrollTop: number;
  viewportHeight: number;
  overscanPx: number;
}

export function computeVirtualRange({
  count,
  getHeight,
  gap,
  scrollTop,
  viewportHeight,
  overscanPx,
}: VirtualRangeInput): VirtualRange {
  if (count <= 0) return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 };

  const windowTop = Math.max(0, scrollTop - overscanPx);
  const windowBottom = scrollTop + viewportHeight + overscanPx;
  let start = -1;
  let end = count;
  let offsetTop = 0;
  let y = 0;

  for (let index = 0; index < count; index += 1) {
    const rowTop = y;
    const rowBottom = rowTop + getHeight(index);
    if (start === -1 && rowBottom >= windowTop) {
      start = index;
      offsetTop = rowTop;
    }
    if (start !== -1 && end === count && rowTop > windowBottom) {
      end = index;
    }
    y = rowBottom + (index < count - 1 ? gap : 0);
  }

  if (start === -1) {
    // Scrolled past the end (e.g. the list just got shorter): show the last rows.
    start = count - 1;
    offsetTop = y - getHeight(count - 1);
    end = count;
  }

  return { start, end, offsetTop, totalHeight: y };
}

/** Average of the measured heights, or the fallback when nothing has been measured yet. */
export function estimateRowHeight(measured: Iterable<number>, fallback: number) {
  let total = 0;
  let count = 0;
  for (const height of measured) {
    total += height;
    count += 1;
  }
  return count > 0 ? total / count : fallback;
}
