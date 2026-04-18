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
  enableTrackpadSwipe?: boolean
  trackpadSwipeThreshold?: number
  trackpadSwipeCooldown?: number
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
  } = options

  const ref = useRef<T>(null)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const wheelResetTimerRef = useRef<NodeJS.Timeout | null>(null)
  const wheelDeltaXRef = useRef(0)
  const wheelCooldownUntilRef = useRef(0)
  const isLongPressRef = useRef(false)
  const didSwipeRef = useRef(false)
  const [isSwiping, setIsSwiping] = useState(false)

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const clearWheelResetTimer = useCallback(() => {
    if (wheelResetTimerRef.current) {
      clearTimeout(wheelResetTimerRef.current)
      wheelResetTimerRef.current = null
    }
  }, [])

  const scheduleDidSwipeReset = useCallback(() => {
    setTimeout(() => {
      didSwipeRef.current = false
    }, 150)
  }, [])

  const resetWheelSwipe = useCallback(() => {
    wheelDeltaXRef.current = 0
    clearWheelResetTimer()
  }, [clearWheelResetTimer])

  const isEventWithinRef = useCallback((target: EventTarget | null) => {
    const element = ref.current
    if (!element || !(target instanceof Node)) return false
    return element === target || element.contains(target)
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
      scheduleDidSwipeReset()
    }
    // Check for vertical swipe
    else if (absY > swipeThreshold && absY > absX) {
      didSwipeRef.current = true
      if (deltaY > 0) {
        onSwipeDown?.()
      } else {
        onSwipeUp?.()
      }
      scheduleDidSwipeReset()
    }

    touchStartRef.current = null
    // Reset swiping state after a short delay to allow click prevention
    setTimeout(() => setIsSwiping(false), 50)
  }, [clearLongPressTimer, swipeThreshold, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown])

  const handleTouchCancel = useCallback(() => {
    clearLongPressTimer()
    touchStartRef.current = null
  }, [clearLongPressTimer])

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!enableTrackpadSwipe || e.ctrlKey || e.metaKey) return
    if (!isEventWithinRef(e.target)) return

    const now = Date.now()
    if (now < wheelCooldownUntilRef.current) {
      return
    }

    const deltaScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1
    const deltaX = e.deltaX * deltaScale
    const deltaY = e.deltaY * deltaScale
    const horizontalDelta = Math.abs(deltaX) > 0 ? deltaX : e.shiftKey ? deltaY : 0
    if (horizontalDelta === 0) return

    const absX = Math.abs(horizontalDelta)
    const absY = Math.abs(deltaY)
    if (absX < 6 || absX < absY * 0.5) return

    e.preventDefault()
    setIsSwiping(true)

    wheelDeltaXRef.current += horizontalDelta
    clearWheelResetTimer()
    wheelResetTimerRef.current = setTimeout(() => {
      wheelDeltaXRef.current = 0
      setIsSwiping(false)
    }, 120)

    if (Math.abs(wheelDeltaXRef.current) < trackpadSwipeThreshold) return

    didSwipeRef.current = true
    if (wheelDeltaXRef.current > 0) {
      onSwipeRight?.()
    } else {
      onSwipeLeft?.()
    }
    scheduleDidSwipeReset()

    wheelCooldownUntilRef.current = now + trackpadSwipeCooldown
    resetWheelSwipe()
    setTimeout(() => setIsSwiping(false), 50)
  }, [
    clearWheelResetTimer,
    enableTrackpadSwipe,
    isEventWithinRef,
    onSwipeLeft,
    onSwipeRight,
    scheduleDidSwipeReset,
    resetWheelSwipe,
    trackpadSwipeCooldown,
    trackpadSwipeThreshold,
  ])

  useEffect(() => {
    const element = ref.current
    if (!element) return

    element.addEventListener("touchstart", handleTouchStart, { passive: true })
    element.addEventListener("touchmove", handleTouchMove, { passive: true })
    element.addEventListener("touchend", handleTouchEnd, { passive: true })
    element.addEventListener("touchcancel", handleTouchCancel, { passive: true })
    if (enableTrackpadSwipe) {
      window.addEventListener("wheel", handleWheel, { passive: false, capture: true })
    }

    return () => {
      element.removeEventListener("touchstart", handleTouchStart)
      element.removeEventListener("touchmove", handleTouchMove)
      element.removeEventListener("touchend", handleTouchEnd)
      element.removeEventListener("touchcancel", handleTouchCancel)
      if (enableTrackpadSwipe) {
        window.removeEventListener("wheel", handleWheel, { capture: true })
      }
      clearLongPressTimer()
      resetWheelSwipe()
    }
  }, [
    clearLongPressTimer,
    enableTrackpadSwipe,
    handleTouchCancel,
    handleTouchEnd,
    handleTouchMove,
    handleTouchStart,
    handleWheel,
    resetWheelSwipe,
  ])

  return { ref, isSwiping, didSwipe: () => didSwipeRef.current }
}
