'use client';

import { useRef, useCallback, useEffect, useState } from 'react';

interface TouchGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onLongPress?: (e: TouchEvent) => void;
  swipeThreshold?: number;
  longPressDelay?: number;
  enableTrackpadSwipe?: boolean;
  trackpadSwipeThreshold?: number;
  trackpadSwipeCooldown?: number;
}

export function getTouchGestureIntent(deltaX: number, deltaY: number) {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  const dragThreshold = 10;

  return {
    movedEnough: absX > dragThreshold || absY > dragThreshold,
    horizontalIntent: absX > dragThreshold && absX > absY * 1.25,
  };
}

export function useTouchGestures<T extends HTMLElement>(options: TouchGestureOptions) {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    onLongPress,
    swipeThreshold = 50,
    longPressDelay = 500,
    enableTrackpadSwipe = true,
    trackpadSwipeThreshold = 90,
    trackpadSwipeCooldown = 450,
  } = options;

  const [element, setElement] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setElement(node), []);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wheelResetTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wheelDeltaXRef = useRef(0);
  const wheelCooldownUntilRef = useRef(0);
  const isLongPressRef = useRef(false);
  const didSwipeRef = useRef(false);
  const suppressTouchClickRef = useRef(false);
  const [isSwiping, setIsSwiping] = useState(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const clearWheelResetTimer = useCallback(() => {
    if (wheelResetTimerRef.current) {
      clearTimeout(wheelResetTimerRef.current);
      wheelResetTimerRef.current = null;
    }
  }, []);

  const scheduleDidSwipeReset = useCallback(() => {
    setTimeout(() => {
      didSwipeRef.current = false;
    }, 150);
  }, []);

  const resetWheelSwipe = useCallback(() => {
    wheelDeltaXRef.current = 0;
    clearWheelResetTimer();
  }, [clearWheelResetTimer]);

  const isEventWithinRef = useCallback(
    (target: EventTarget | null) => {
      if (!element || !(target instanceof Node)) return false;
      return element === target || element.contains(target);
    },
    [element],
  );

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      clearLongPressTimer();
      if (e.touches.length !== 1) {
        touchStartRef.current = null;
        suppressTouchClickRef.current = true;
        setIsSwiping(false);
        return;
      }
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
      isLongPressRef.current = false;
      didSwipeRef.current = false;
      suppressTouchClickRef.current = false;
      setIsSwiping(false);

      if (onLongPress) {
        longPressTimerRef.current = setTimeout(() => {
          isLongPressRef.current = true;
          onLongPress(e);
          // Add haptic feedback if available
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
        }, longPressDelay);
      }
    },
    [clearLongPressTimer, onLongPress, longPressDelay],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!touchStartRef.current) return;
      if (e.touches.length !== 1) {
        clearLongPressTimer();
        touchStartRef.current = null;
        suppressTouchClickRef.current = true;
        setIsSwiping(false);
        return;
      }

      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;
      const intent = getTouchGestureIntent(deltaX, deltaY);

      if (intent.movedEnough) {
        clearLongPressTimer();
        if (intent.horizontalIntent && !didSwipeRef.current) {
          didSwipeRef.current = true;
          suppressTouchClickRef.current = true;
          setIsSwiping(true);
        }
      }
    },
    [clearLongPressTimer],
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      clearLongPressTimer();

      if (!touchStartRef.current || isLongPressRef.current) {
        touchStartRef.current = null;
        // Reset swiping state after a short delay to allow click prevention
        setTimeout(() => setIsSwiping(false), 50);
        return;
      }

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Check for horizontal swipe
      if (absX >= swipeThreshold && getTouchGestureIntent(deltaX, deltaY).horizontalIntent) {
        didSwipeRef.current = true;
        suppressTouchClickRef.current = true;
        if (deltaX > 0) {
          onSwipeRight?.();
        } else {
          onSwipeLeft?.();
        }
        scheduleDidSwipeReset();
      }
      // Check for vertical swipe
      else if (absY > swipeThreshold && absY > absX && (onSwipeDown || onSwipeUp)) {
        didSwipeRef.current = true;
        suppressTouchClickRef.current = true;
        if (deltaY > 0) {
          onSwipeDown?.();
        } else {
          onSwipeUp?.();
        }
        scheduleDidSwipeReset();
      }

      touchStartRef.current = null;
      // Reset swiping state after a short delay to allow click prevention
      setTimeout(() => setIsSwiping(false), 50);
    },
    [clearLongPressTimer, swipeThreshold, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, scheduleDidSwipeReset],
  );

  const handleTouchCancel = useCallback(() => {
    clearLongPressTimer();
    touchStartRef.current = null;
    setIsSwiping(false);
  }, [clearLongPressTimer]);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      suppressTouchClickRef.current = false;
    }
  }, []);

  const handleClickCapture = useCallback((e: MouseEvent) => {
    // Compatibility clicks can arrive after the swipe timer, even on the newly rendered page.
    if (!suppressTouchClickRef.current || e.detail === 0) return;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!enableTrackpadSwipe || e.ctrlKey || e.metaKey) return;
      if (!isEventWithinRef(e.target)) return;

      const now = Date.now();
      if (now < wheelCooldownUntilRef.current) {
        return;
      }

      const deltaScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
      const deltaX = e.deltaX * deltaScale;
      const deltaY = e.deltaY * deltaScale;
      const horizontalDelta = Math.abs(deltaX) > 0 ? deltaX : e.shiftKey ? deltaY : 0;
      if (horizontalDelta === 0) return;

      const absX = Math.abs(horizontalDelta);
      const absY = Math.abs(deltaY);
      if (absX < 8 || absX < absY * 1.15) return;

      e.preventDefault();
      setIsSwiping(true);

      wheelDeltaXRef.current += horizontalDelta;
      clearWheelResetTimer();
      wheelResetTimerRef.current = setTimeout(() => {
        wheelDeltaXRef.current = 0;
        setIsSwiping(false);
      }, 120);

      if (Math.abs(wheelDeltaXRef.current) < trackpadSwipeThreshold) return;

      didSwipeRef.current = true;
      if (wheelDeltaXRef.current > 0) {
        onSwipeLeft?.();
      } else {
        onSwipeRight?.();
      }
      scheduleDidSwipeReset();

      wheelCooldownUntilRef.current = now + trackpadSwipeCooldown;
      resetWheelSwipe();
      setTimeout(() => setIsSwiping(false), 50);
    },
    [
      clearWheelResetTimer,
      enableTrackpadSwipe,
      isEventWithinRef,
      onSwipeLeft,
      onSwipeRight,
      scheduleDidSwipeReset,
      resetWheelSwipe,
      trackpadSwipeCooldown,
      trackpadSwipeThreshold,
    ],
  );

  // oxlint-disable-next-line react-doctor/advanced-event-handler-refs -- the handlers are memoized, so re-subscribing only happens when their inputs change.
  useEffect(() => {
    if (!element) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });
    element.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('click', handleClickCapture, { capture: true });
    element.addEventListener('dblclick', handleClickCapture, { capture: true });
    if (enableTrackpadSwipe) {
      // oxlint-disable-next-line react-doctor/client-passive-event-listeners -- handleWheel calls preventDefault to stop the browser's own swipe navigation.
      window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    }

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('touchcancel', handleTouchCancel);
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('click', handleClickCapture, { capture: true });
      element.removeEventListener('dblclick', handleClickCapture, { capture: true });
      if (enableTrackpadSwipe) {
        window.removeEventListener('wheel', handleWheel, { capture: true });
      }
      clearLongPressTimer();
      touchStartRef.current = null;
      resetWheelSwipe();
    };
  }, [
    element,
    clearLongPressTimer,
    enableTrackpadSwipe,
    handleClickCapture,
    handlePointerDown,
    handleTouchCancel,
    handleTouchEnd,
    handleTouchMove,
    handleTouchStart,
    handleWheel,
    resetWheelSwipe,
  ]);

  return { ref, isSwiping, didSwipe: () => didSwipeRef.current };
}
