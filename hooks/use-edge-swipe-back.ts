'use client';

import { useEffect, useRef, useState } from 'react';
import { hasOpenOverlays } from '@/hooks/use-overlay';
import {
  classifyEdgeDrag,
  edgeSwipeProgress,
  isEdgeStart,
  shouldCommitEdgeSwipe,
  ViewBackStack,
} from '@/lib/edge-swipe';

const VELOCITY_WINDOW_MS = 80;

function isStandalone() {
  if (typeof window === 'undefined') return false;
  const navigatorStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return Boolean(navigatorStandalone) || window.matchMedia?.('(display-mode: standalone)').matches;
}

/**
 * Edge swipe-back for the installed app, where iOS gives no browser back gesture. A swipe
 * from the left edge closes the top overlay (through history, like the back button) or
 * returns to the previously visited main view, which then animates with the usual view
 * transition. In a browser tab the system gesture already does this, so the hook stays off.
 * Cmd+[ and Cmd+] step back and forward through the same views everywhere.
 */
export function useEdgeSwipeBack<View extends string>(
  view: View,
  goToView: (view: View) => void,
  homeView: View,
  enabled = true,
) {
  const [stack] = useState(() => new ViewBackStack<View>());
  const previousViewRef = useRef(view);
  const latest = useRef({ view, goToView, homeView, enabled });

  useEffect(() => {
    latest.current = { view, goToView, homeView, enabled };
  }, [enabled, goToView, homeView, view]);

  useEffect(() => {
    stack.visit(previousViewRef.current, view);
    previousViewRef.current = view;
  }, [stack, view]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      if (event.key !== '[' && event.key !== ']') return;
      const { view: current, goToView: go, enabled: on } = latest.current;
      if (!on) return;
      if (event.key === '[') {
        if (hasOpenOverlays()) {
          event.preventDefault();
          window.history.back();
          return;
        }
        // Nothing in-app to go back to: leave Cmd+[ to the browser.
        if (stack.peek() === undefined) return;
        event.preventDefault();
        go(stack.back(current)!);
        return;
      }
      if (hasOpenOverlays()) return;
      const next = stack.forward(current);
      if (next === undefined) return;
      event.preventDefault();
      go(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stack]);

  useEffect(() => {
    if (!isStandalone()) return;
    const root = document.documentElement;
    let gesture: {
      id: number;
      x: number;
      y: number;
      state: 'pending' | 'back';
      samples: Array<{ x: number; t: number }>;
    } | null = null;

    const canGoBack = () => {
      const { view: current, homeView: home, enabled: on } = latest.current;
      if (!on) return false;
      if (hasOpenOverlays()) return true;
      // On the binder itself, sideways swipes turn pages; only other views swipe back.
      return current !== home && stack.peek() !== undefined;
    };
    const clearIndicator = () => {
      delete root.dataset.edgeBack;
      root.style.removeProperty('--edge-back-progress');
    };
    const suppressNextClick = () => {
      const swallow = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400);
    };

    const onDown = (event: PointerEvent) => {
      if (gesture || event.button !== 0 || !event.isPrimary) return;
      if (!isEdgeStart(event.clientX) || !canGoBack()) return;
      gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        state: 'pending',
        samples: [{ x: event.clientX, t: event.timeStamp }],
      };
    };
    const onMove = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (gesture.state === 'pending') {
        const decision = classifyEdgeDrag(dx, dy);
        if (decision === 'cancel') {
          gesture = null;
          return;
        }
        if (decision === 'pending') return;
        gesture.state = 'back';
        root.dataset.edgeBack = '';
      }
      gesture.samples.push({ x: event.clientX, t: event.timeStamp });
      if (gesture.samples.length > 12) gesture.samples.shift();
      root.style.setProperty('--edge-back-progress', edgeSwipeProgress(dx).toFixed(3));
    };
    const onUp = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const current = gesture;
      gesture = null;
      clearIndicator();
      if (current.state !== 'back') return;
      const dx = event.clientX - current.x;
      const last = current.samples.at(-1)!;
      const first = current.samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) ?? last;
      const velocity =
        event.timeStamp - last.t > VELOCITY_WINDOW_MS || last.t === first.t
          ? 0
          : (last.x - first.x) / (last.t - first.t);
      if (!shouldCommitEdgeSwipe(dx, velocity)) return;
      suppressNextClick();
      if (hasOpenOverlays()) {
        window.history.back();
        return;
      }
      const previous = stack.back(latest.current.view);
      if (previous) latest.current.goToView(previous);
    };
    const onCancel = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      gesture = null;
      clearIndicator();
    };

    window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    window.addEventListener('pointerup', onUp, { capture: true, passive: true });
    window.addEventListener('pointercancel', onCancel, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('pointercancel', onCancel, { capture: true });
      clearIndicator();
    };
  }, [stack]);
}
