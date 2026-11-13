'use client';

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { OverlayStack } from '@/lib/overlay-stack';
import { useSheetDrag } from '@/hooks/use-sheet-drag';
import { installTouchScrollGuard, removeTouchScrollGuard } from '@/lib/touch-scroll-guard';

const stack = new OverlayStack();
const OVERLAY_HISTORY_KEY = '__holofolderOverlay';
let scrollLockCount = 0;
let savedBodyOverflow = '';
let savedHtmlOverflow = '';

// History bookkeeping shared by all overlays. Closing overlays programmatically pops their
// history entries in one batched history.go(-n); pushes requested while that traversal is
// still pending are deferred until it lands so entries never get out of order.
let ignoredPopstates = 0;
const cleanupPopstates = new WeakSet<PopStateEvent>();
let queuedBacks = 0;
let backFlushScheduled = false;
let lastPopstateIgnored = false;
const deferredPushes: Array<() => void> = [];
let globalPopstateListenerInstalled = false;

function installGlobalPopstateListener() {
  if (globalPopstateListenerInstalled || typeof window === 'undefined') return;
  globalPopstateListenerInstalled = true;
  window.addEventListener('popstate', (event) => {
    if (ignoredPopstates > 0) {
      cleanupPopstates.add(event);
      ignoredPopstates -= 1;
      lastPopstateIgnored = true;
      if (ignoredPopstates === 0) {
        const pushes = deferredPushes.splice(0);
        pushes.forEach((push) => push());
      }
      return;
    }
    lastPopstateIgnored = false;
  });
}

function requestHistoryBack() {
  queuedBacks += 1;
  if (backFlushScheduled) return;
  backFlushScheduled = true;
  queueMicrotask(() => {
    backFlushScheduled = false;
    const count = queuedBacks;
    queuedBacks = 0;
    if (count <= 0) return;
    ignoredPopstates += 1;
    window.history.go(-count);
  });
}

function requestHistoryPush(push: () => void) {
  if (ignoredPopstates > 0 || queuedBacks > 0 || backFlushScheduled) {
    deferredPushes.push(push);
    return;
  }
  push();
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type=hidden])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  "[tabindex]:not([tabindex='-1'])",
].join(',');

function lockScroll() {
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    installTouchScrollGuard();
  }
  scrollLockCount += 1;
}

function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
    document.documentElement.style.overflow = savedHtmlOverflow;
    removeTouchScrollGuard();
  }
}

/**
 * Run a navigation once the history entries of overlays that just closed are popped, so the back traversal
 * can't undo it. Call it after the closing render has committed (e.g. from an effect).
 */
export function runAfterOverlayHistory(navigate: () => void) {
  if (typeof window === 'undefined') return;
  installGlobalPopstateListener();
  requestHistoryPush(navigate);
}

/** Classify this cleanup traversal before or after the shared listener flushes deferred pushes. */
export function isOverlayHistoryCleanup(event: PopStateEvent) {
  return ignoredPopstates > 0 || cleanupPopstates.has(event);
}

/** Whether any overlay (sheet, dialog, menu) is currently open. */
export function hasOpenOverlays() {
  return stack.size > 0;
}

/** Close every open overlay (used when switching main views/tabs). */
/** Number of overlays currently open (re-renders when it changes). */
export function useOpenOverlayCount() {
  return useSyncExternalStore(
    (listener) => stack.subscribe(listener),
    () => stack.size,
    () => 0,
  );
}

export function closeAllOverlays() {
  stack.closeAll();
}

export interface UseOverlayOptions {
  /** Element that contains the overlay content; used for focus trap and initial focus. */
  containerRef?: RefObject<HTMLElement | null>;
  /** Lock page scroll while open (default true). */
  lockScroll?: boolean;
  /** Trap Tab focus inside the container and restore focus on close (default true). */
  trapFocus?: boolean;
  /** Push a history entry so the browser/Android back button closes the overlay (default true). */
  history?: boolean;
  /** Move focus into the overlay when it opens (default true). */
  autoFocus?: boolean;
  /** What had focus before the overlay took it, when the overlay focuses itself before this hook's effect runs. */
  openerRef?: RefObject<HTMLElement | null>;
}

let lastPressedControl: HTMLElement | null = null;
let focusOriginTrackerInstalled = false;

/** Remembers the last focusable control the user pressed, used to return focus on close. */
function installFocusOriginTracker() {
  if (focusOriginTrackerInstalled || typeof window === 'undefined') return;
  focusOriginTrackerInstalled = true;
  const remember = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest<HTMLElement>(FOCUSABLE_SELECTOR) ?? null;
    if (control) lastPressedControl = control;
  };
  window.addEventListener('pointerdown', remember, true);
  window.addEventListener('keydown', remember, true);
}

// Track from page load so the very first overlay also knows which control opened it.
installFocusOriginTracker();

/**
 * Shared behaviour for every modal/sheet/popover: Escape closes the topmost overlay,
 * the back button closes it instead of leaving the page, focus is trapped and returned,
 * and page scroll is locked while it is open.
 */
export function useOverlay(open: boolean, onClose: () => void, options: UseOverlayOptions = {}) {
  const {
    containerRef,
    lockScroll: shouldLockScroll = true,
    trapFocus = true,
    history: useHistory = true,
    autoFocus = true,
    openerRef,
  } = options;
  const onCloseRef = useRef(onClose);
  // Options that may change while the overlay is open are read through a ref so that toggling
  // them never re-registers the overlay (which would reorder the stack and the history entries).
  const liveOptionsRef = useRef({ containerRef, trapFocus, autoFocus, openerRef });
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    liveOptionsRef.current = { containerRef, trapFocus, autoFocus, openerRef };
  });

  const isScrollLocked = open && shouldLockScroll;
  useEffect(() => {
    if (!isScrollLocked || typeof window === 'undefined') return;
    lockScroll();
    return unlockScroll;
  }, [isScrollLocked]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const { containerRef, autoFocus, openerRef } = liveOptionsRef.current;

    installFocusOriginTracker();
    // An `autoFocus` field inside the overlay may already have taken focus by the time effects
    // run, so fall back to the control the user last pressed to open it.
    const focusedAtOpen = openerRef?.current ?? document.activeElement;
    const activeAtOpen = focusedAtOpen instanceof HTMLElement ? focusedAtOpen : null;
    const openedContainer = containerRef?.current ?? null;
    const isOutside = (element: HTMLElement | null) =>
      Boolean(element && element !== document.body && !(openedContainer && openedContainer.contains(element)));
    const previouslyFocused = isOutside(activeAtOpen)
      ? activeAtOpen
      : isOutside(lastPressedControl)
        ? lastPressedControl
        : null;
    let closedByHistory = false;
    let historyEntryPushed = false;
    let disposed = false;

    installGlobalPopstateListener();
    const entry = stack.push(() => onCloseRef.current());

    if (useHistory) {
      requestHistoryPush(() => {
        if (disposed) return;
        const currentState =
          window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
        window.history.pushState({ ...currentState, [OVERLAY_HISTORY_KEY]: entry.id }, '');
        historyEntryPushed = true;
      });
    }

    const handlePopState = () => {
      if (lastPopstateIgnored) return;
      if (!historyEntryPushed || !stack.isTop(entry.id)) return;
      closedByHistory = true;
      onCloseRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!stack.isTop(entry.id)) return;

      if (event.key === 'Escape') {
        // Let an open Radix select/menu/popover close itself first.
        if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
        const target = event.target as HTMLElement | null;
        // Let inputs that use Escape to clear themselves do so first.
        if (target?.dataset?.overlayEscape === 'clear' && 'value' in target && (target as HTMLInputElement).value) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }

      if (event.key === 'Tab' && liveOptionsRef.current.trapFocus) {
        const container = liveOptionsRef.current.containerRef?.current;
        if (!container) return;
        const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (element) => element.offsetParent !== null || element === document.activeElement,
        );
        if (focusable.length === 0) {
          event.preventDefault();
          container.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey && (active === first || !container.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !container.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    // A long press opens an overlay under the finger. When it lifts, iOS hit-tests the click at that point, which is now
    // the backdrop: swallow a backdrop click whose press began before the overlay opened, so it doesn't close at once.
    let pressedSinceOpen = false;
    const handlePointerDown = () => {
      pressedSinceOpen = true;
    };
    const handleStrayClick = (event: MouseEvent) => {
      if (pressedSinceOpen || !(event.target instanceof Element) || !event.target.closest('[data-overlay-backdrop]'))
        return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('click', handleStrayClick, true);

    let focusFrame = 0;
    if (autoFocus && containerRef) {
      focusFrame = window.requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container || container.contains(document.activeElement)) return;
        if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
        container.focus({ preventScroll: true });
      });
    }

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('click', handleStrayClick, true);
      stack.remove(entry.id);

      disposed = true;
      if (historyEntryPushed && !closedByHistory) {
        requestHistoryBack();
      }

      if (liveOptionsRef.current.trapFocus && previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, useHistory]);
}

/**
 * Swipe-down-to-dismiss for bottom sheets. Spread the returned handlers on the grabber/header.
 * The sheet element follows the finger and closes once dragged far/fast enough.
 */
/** Drag-to-dismiss for bottom sheets; see useSheetDrag for the gesture details. */
export function useSwipeToDismiss(sheetRef: RefObject<HTMLElement | null>, onDismiss: () => void, enabled = true) {
  return useSheetDrag(sheetRef, onDismiss, enabled);
}
