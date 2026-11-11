export const PAGE_TURN_MS = 180;
export const PAGE_TURN_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Wait this long before prefetching neighbours, keeping visible images first. */
export const ADJACENT_PREFETCH_DELAY_MS = 120;

/**
 * Pages one turn away from what is on screen, nearest first (next before previous).
 * `pagesPerTurn` is 1 for single pages and 2 for a two-page spread.
 */
export function getAdjacentPageNumbers(visiblePages: number[], totalPages: number, pagesPerTurn: number): number[] {
  const pages = visiblePages.filter((page) => Number.isInteger(page) && page >= 1 && page <= totalPages);
  if (pages.length === 0 || totalPages <= 0) return [];
  const step = Math.max(1, Math.floor(pagesPerTurn));
  const first = Math.min(...pages);
  const last = Math.max(...pages);
  const adjacent: number[] = [];
  for (let offset = 1; offset <= step; offset += 1) {
    if (last + offset <= totalPages) adjacent.push(last + offset);
  }
  for (let offset = 1; offset <= step; offset += 1) {
    if (first - offset >= 1) adjacent.push(first - offset);
  }
  return adjacent.filter((page) => !pages.includes(page));
}
