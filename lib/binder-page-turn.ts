/**
 * Binder page-turn timing and adjacent-page prefetch helpers.
 *
 * The page turn fades/slides the current page out, swaps the page, then lets the new
 * page settle back in. It used to take ~350ms (150ms out + 50ms + 150ms in); it now takes
 * ~170ms with a snappier ease-out, and is instant with prefers-reduced-motion.
 */
export const PAGE_TURN_OUT_MS = 80
export const PAGE_TURN_SETTLE_MS = 10
export const PAGE_TURN_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)"
/** Wait this long after a page settles before prefetching its neighbours. */
export const ADJACENT_PREFETCH_DELAY_MS = 120

export interface PageTurnTiming {
  /** CSS transition duration for the fade/slide, in ms. */
  durationMs: number
  /** Delay before the page number is swapped, in ms. */
  outMs: number
  /** Delay after the swap before the transition state is cleared, in ms. */
  settleMs: number
}

export function getPageTurnTiming(prefersReducedMotion: boolean): PageTurnTiming {
  if (prefersReducedMotion) {
    return { durationMs: 0, outMs: 0, settleMs: 0 }
  }
  return { durationMs: PAGE_TURN_OUT_MS, outMs: PAGE_TURN_OUT_MS, settleMs: PAGE_TURN_SETTLE_MS }
}

/**
 * Pages one turn away from what is on screen, nearest first (next before previous).
 * `pagesPerTurn` is 1 for single pages and 2 for a two-page spread.
 */
export function getAdjacentPageNumbers(visiblePages: number[], totalPages: number, pagesPerTurn: number): number[] {
  const pages = visiblePages.filter((page) => Number.isInteger(page) && page >= 1 && page <= totalPages)
  if (pages.length === 0 || totalPages <= 0) return []
  const step = Math.max(1, Math.floor(pagesPerTurn))
  const first = Math.min(...pages)
  const last = Math.max(...pages)
  const adjacent: number[] = []
  for (let offset = 1; offset <= step; offset += 1) {
    if (last + offset <= totalPages) adjacent.push(last + offset)
  }
  for (let offset = 1; offset <= step; offset += 1) {
    if (first - offset >= 1) adjacent.push(first - offset)
  }
  return adjacent.filter((page) => !pages.includes(page))
}
