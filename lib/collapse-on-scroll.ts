/**
 * Hysteresis for "collapse the view heading once the list scrolls" on phones.
 * Collapsing gives the scroller more height, which can clamp scrollTop on short
 * lists; requiring real scroll room and separate collapse/expand thresholds
 * keeps the header from flickering between the two states.
 */
export const COLLAPSE_AT_PX = 32
export const EXPAND_AT_PX = 4
/** Only collapse when the list can scroll well past the space the heading frees up. */
export const MIN_SCROLL_RANGE_PX = 120

export function nextCollapsedState(collapsed: boolean, scrollTop: number, scrollRange: number): boolean {
  if (!collapsed) {
    return scrollRange >= MIN_SCROLL_RANGE_PX && scrollTop > COLLAPSE_AT_PX
  }
  return scrollTop > EXPAND_AT_PX
}
