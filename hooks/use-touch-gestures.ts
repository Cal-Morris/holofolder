"use client"

import { useRef, useCallback, useEffect, useState } from "react"

interface TouchGestureOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onSwipeUp?: () => void
  onSwipeDown?: () => void
  onLongPress?: (e: TouchEvent) => void
  swipeThreshold?: number
  longPressDelay?: number
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
  } = options

  const ref = useRef<T>(null)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isLongPressRef = useRef(false)
  const didSwipeRef = useRef(false)
  const [isSwiping, setIsSwiping] = useState(false)

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
    isLongPressRef.current = false
    didSwipeRef.current = false
    setIsSwiping(false)

    if (onLongPress) {
      longPressTimerRef.current = setTimeout(() => {
        isLongPressRef.current = true
        onLongPress(e)
        // Add haptic feedback if available
        if (navigator.vibrate) {
          navigator.vibrate(50)
        }
      }, longPressDelay)
    }
  }, [onLongPress, longPressDelay])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return

    const touch = e.touches[0]
    const deltaX = Math.abs(touch.clientX - touchStartRef.current.x)
    const deltaY = Math.abs(touch.clientY - touchStartRef.current.y)

    // If moved too much, cancel long press and mark as swiping
    if (deltaX > 10 || deltaY > 10) {
      clearLongPressTimer()
      if (!didSwipeRef.current) {
        didSwipeRef.current = true
        setIsSwiping(true)
      }
    }
  }, [clearLongPressTimer])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    clearLongPressTimer()

    if (!touchStartRef.current || isLongPressRef.current) {
      touchStartRef.current = null
      // Reset swiping state after a short delay to allow click prevention
      setTimeout(() => setIsSwiping(false), 50)
      return
    }

    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - touchStartRef.current.x
    const deltaY = touch.clientY - touchStartRef.current.y
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    // Check for horizontal swipe
    if (absX > swipeThreshold && absX > absY) {
      didSwipeRef.current = true
      if (deltaX > 0) {
        onSwipeRight?.()
      } else {
        onSwipeLeft?.()
      }
    }
    // Check for vertical swipe
    else if (absY > swipeThreshold && absY > absX) {
      didSwipeRef.current = true
      if (deltaY > 0) {
        onSwipeDown?.()
      } else {
        onSwipeUp?.()
      }
    }

    touchStartRef.current = null
    // Reset swiping state after a short delay to allow click prevention
    setTimeout(() => setIsSwiping(false), 50)
  }, [clearLongPressTimer, swipeThreshold, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown])

  const handleTouchCancel = useCallback(() => {
    clearLongPressTimer()
    touchStartRef.current = null
  }, [clearLongPressTimer])

  useEffect(() => {
    const element = ref.current
    if (!element) return

    element.addEventListener("touchstart", handleTouchStart, { passive: true })
    element.addEventListener("touchmove", handleTouchMove, { passive: true })
    element.addEventListener("touchend", handleTouchEnd, { passive: true })
    element.addEventListener("touchcancel", handleTouchCancel, { passive: true })

    return () => {
      element.removeEventListener("touchstart", handleTouchStart)
      element.removeEventListener("touchmove", handleTouchMove)
      element.removeEventListener("touchend", handleTouchEnd)
      element.removeEventListener("touchcancel", handleTouchCancel)
      clearLongPressTimer()
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel, clearLongPressTimer])

  return { ref, isSwiping, didSwipe: () => didSwipeRef.current }
}
