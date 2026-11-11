'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { reachableScrollTop, ViewScrollMemory } from '@/lib/view-scroll-memory';

/** Scrollers that belong to a main view (List, Sets, Wanted, Pokémon browse). */
const VIEW_SCROLLER_SELECTOR = '[data-testid="view-scroller"], [data-testid="wanted-list"]';
/** Views are lazy-loaded and virtualised: wait for the scroller, then for its content to grow tall enough. */
const MOUNT_TIMEOUT_MS = 10_000;
const RESTORE_TIMEOUT_MS = 5000;
/**
 * Virtualised rows are measured after they render, which can shift content (and, through scroll
 * anchoring, scrollTop) a frame or two after the restore lands. Keep holding the target until it
 * has stayed put for this long; any user input still cancels immediately.
 */
const SETTLE_MS = 400;

function sessionStore() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

let memory: ViewScrollMemory | null = null;
function getMemory() {
  if (!memory)
    memory = new ViewScrollMemory(sessionStore, typeof window === 'undefined' ? '' : window.location.pathname);
  return memory;
}

/**
 * Keeps each main view's scroll position across opening cards, switching dock tabs and
 * back/forward navigation. Listens for scrolls inside `containerRef` and, when `view`
 * becomes active again, scrolls its scroller back once the content is tall enough.
 */
export function useViewScrollRestoration(containerRef: RefObject<HTMLElement | null>, view: string, enabled = true) {
  const viewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Save positions as the user scrolls (one write per frame).
  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return;
    let frame = 0;
    let pending: { view: string; top: number } | null = null;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(VIEW_SCROLLER_SELECTOR)) return;
      pending = { view: viewRef.current, top: target.scrollTop };
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (pending) getMemory().set(pending.view, pending.top);
        pending = null;
      });
    };
    container.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll, { capture: true });
      if (frame) window.cancelAnimationFrame(frame);
      if (pending) getMemory().set(pending.view, pending.top);
    };
  }, [containerRef, enabled]);

  // Restore when a view (re)appears.
  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return;
    const target = getMemory().get(view);
    if (target <= 0) return;
    let frame = 0;
    let cancelled = false;
    const startedAt = performance.now();
    let foundAt = 0;
    let lastHeight = 0;
    let settledSince = 0;
    // A deliberate touch or wheel wins over a restore that is still waiting for content.
    const cancel = () => {
      cancelled = true;
    };
    container.addEventListener('wheel', cancel, { passive: true });
    container.addEventListener('touchstart', cancel, { passive: true });
    container.addEventListener('keydown', cancel);
    const step = () => {
      if (cancelled || viewRef.current !== view) return;
      const scroller = container.querySelector<HTMLElement>(VIEW_SCROLLER_SELECTOR);
      const now = performance.now();
      if (scroller) {
        foundAt ||= now;
        // Content still growing (lazy rows, measurement): give it more time.
        if (scroller.scrollHeight > lastHeight) {
          lastHeight = scroller.scrollHeight;
          foundAt = now;
        }
        const top = reachableScrollTop(target, scroller.scrollHeight, scroller.clientHeight);
        if (Math.abs(scroller.scrollTop - top) > 1) {
          scroller.scrollTop = top;
          settledSince = 0;
        } else if (top >= target - 1) {
          settledSince ||= now;
          if (now - settledSince >= SETTLE_MS) return;
        }
      }
      const waiting = foundAt ? now - foundAt < RESTORE_TIMEOUT_MS : now - startedAt < MOUNT_TIMEOUT_MS;
      if (waiting) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      container.removeEventListener('wheel', cancel);
      container.removeEventListener('touchstart', cancel);
      container.removeEventListener('keydown', cancel);
    };
  }, [containerRef, enabled, view]);
}
