'use client';

import { useCallback, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';

import { getTouchGestureIntent } from '@/hooks/use-touch-gestures';

/**
 * Press-and-hold for buttons: a touch held still for `delay` ms, or a right-click / Android long-press
 * `contextmenu`. One hook can serve a whole list, since only one press is live at a time: spread
 * `bind(onLongPress)` on each button and return early from its `onClick` when `suppressClick(event)` is true,
 * so the tap that ends a hold doesn't also count as a tap.
 */
export function useLongPress(delay = 400) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const bind = useCallback(
    (onLongPress: () => void, disabled = false) => {
      const fire = () => {
        cancel();
        // Android sends `contextmenu` as well as the hold timer firing; count the press once.
        if (fired.current || disabled) return;
        fired.current = true;
        onLongPress();
      };
      return {
        onPointerDown: () => {
          fired.current = false;
        },
        onTouchStart: (event: ReactTouchEvent) => {
          const touch = event.touches[0];
          start.current = { x: touch.clientX, y: touch.clientY };
          fired.current = false;
          cancel();
          if (!disabled) timer.current = setTimeout(fire, delay);
        },
        onTouchMove: (event: ReactTouchEvent) => {
          const touch = event.touches[0];
          if (getTouchGestureIntent(touch.clientX - start.current.x, touch.clientY - start.current.y).movedEnough) {
            cancel();
          }
        },
        onTouchEnd: cancel,
        onTouchCancel: cancel,
        onContextMenu: (event: ReactMouseEvent) => {
          event.preventDefault();
          fire();
        },
      };
    },
    [cancel, delay],
  );

  /** True for the click that ends a hold. Keyboard clicks (`detail === 0`) always go through. */
  const suppressClick = useCallback((event: ReactMouseEvent) => event.detail !== 0 && fired.current, []);

  return { bind, suppressClick };
}
