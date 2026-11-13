/**
 * Sticky glass (the dock and sticky filter bars) re-blurs whatever moves behind it on
 * every scroll frame, which is what makes iOS Safari stutter. While anything scrolls, the document
 * carries `data-scrolling` and those surfaces swap the live blur for a near-opaque fill
 * (globals.css); the blur comes back once scrolling has been quiet for `SCROLL_SETTLE_MS`, or
 * `SCROLL_END_SETTLE_MS` after the browser reports `scrollend`. Chrome also fires `scrollend` after
 * every programmatic scroll, so it only shortens the wait instead of unfreezing on the spot, which
 * would flip the blur on and off every frame while code drives a scroller.
 */
export const SCROLL_SETTLE_MS = 150;
export const SCROLL_END_SETTLE_MS = 50;
export const SCROLLING_ATTRIBUTE = 'data-scrolling';

type Timer = ReturnType<typeof setTimeout>;

export type ScrollFreezeOptions = {
  freeze: () => void;
  unfreeze: () => void;
  settleMs?: number;
  endSettleMs?: number;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

export function createScrollFreeze({
  freeze,
  unfreeze,
  settleMs = SCROLL_SETTLE_MS,
  endSettleMs = SCROLL_END_SETTLE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: ScrollFreezeOptions) {
  let frozen = false;
  let timer: Timer | null = null;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const settle = () => {
    cancel();
    if (!frozen) return;
    frozen = false;
    unfreeze();
  };
  const settleIn = (ms: number) => {
    cancel();
    timer = setTimer(settle, ms);
  };

  return {
    /** Every scroll event: freeze once, then push the settle deadline back. */
    onScroll() {
      if (!frozen) {
        frozen = true;
        freeze();
      }
      settleIn(settleMs);
    },
    /** `scrollend` (after momentum too) brings the blur back sooner, unless scrolling resumes. */
    onScrollEnd() {
      if (frozen) settleIn(endSettleMs);
    },
    isFrozen: () => frozen,
    dispose: settle,
  };
}
