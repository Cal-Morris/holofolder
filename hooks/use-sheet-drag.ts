"use client"

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { dismissDuration, dragOffset, releaseVelocity, shouldDismissDrag, dragDistanceForOffset, type DragSample } from "@/lib/sheet-drag"

const SNAP_BACK = "translate 260ms cubic-bezier(0.22, 1.2, 0.36, 1)"
const MAX_SAMPLES = 12

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

/**
 * Drag a bottom sheet down to dismiss it. The sheet follows the finger, rubber-bands when
 * pulled up, and on release either snaps back or slides out at the release velocity before
 * `onDismiss` runs. Spread the returned props on the grabber/header element.
 */
export function useSheetDrag(sheetRef: RefObject<HTMLElement | null>, onDismiss: () => void, enabled = true) {
  const startRef = useRef<{ y: number; pointerId: number } | null>(null)
  const samplesRef = useRef<DragSample[]>([])
  const deltaRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const onDismissRef = useRef(onDismiss)

  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const clearStyles = useCallback(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.style.transition = ""
    sheet.style.translate = ""
    delete sheet.dataset.sheetDragging
  }, [sheetRef])

  const later = useCallback((ms: number, run: () => void) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      run()
    }, ms)
  }, [])

  const snapBack = useCallback(() => {
    const sheet = sheetRef.current
    startRef.current = null
    deltaRef.current = 0
    samplesRef.current = []
    if (!sheet) return
    delete sheet.dataset.sheetDragging
    if (prefersReducedMotion()) {
      clearStyles()
      return
    }
    sheet.style.transition = SNAP_BACK
    sheet.style.translate = ""
    later(280, clearStyles)
  }, [clearStyles, later, sheetRef])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0 || startRef.current) return
    const target = event.target as HTMLElement
    if (target.closest("button, a, input, select, textarea, [data-no-swipe]")) return
    // Catch a sheet that is still snapping back: stop the animation where it is.
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const sheet = sheetRef.current
    const translate = sheet ? getComputedStyle(sheet).translate.split(" ") : []
    const offset = Number.parseFloat(translate[1] ?? "0") || 0
    // Undo rubber-banding so the first move resumes at the visible position.
    const rawOffset = dragDistanceForOffset(offset)
    if (sheet) {
      sheet.style.transition = "none"
      sheet.style.translate = `0 ${offset}px`
    }
    startRef.current = { y: event.clientY - rawOffset, pointerId: event.pointerId }
    samplesRef.current = [{ y: event.clientY, time: event.timeStamp || performance.now() }]
    deltaRef.current = rawOffset
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Pointer already gone (e.g. released during the same frame); the drag still works uncaptured.
    }
  }, [enabled, sheetRef])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = startRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const delta = event.clientY - start.y
    deltaRef.current = delta
    const samples = samplesRef.current
    samples.push({ y: event.clientY, time: event.timeStamp || performance.now() })
    if (samples.length > MAX_SAMPLES) samples.shift()
    const sheet = sheetRef.current
    if (sheet) {
      sheet.dataset.sheetDragging = ""
      sheet.style.transition = "none"
      sheet.style.translate = `0 ${dragOffset(delta)}px`
    }
  }, [sheetRef])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = startRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const delta = deltaRef.current
    const velocity = releaseVelocity(samplesRef.current, event.timeStamp || performance.now())
    const sheet = sheetRef.current
    const height = sheet?.getBoundingClientRect().height ?? 0
    if (!shouldDismissDrag(delta, velocity, height)) {
      snapBack()
      return
    }
    startRef.current = null
    deltaRef.current = 0
    samplesRef.current = []
    if (!sheet || prefersReducedMotion()) {
      onDismissRef.current()
      later(32, clearStyles)
      return
    }
    // Slide the rest of the way out at roughly the release speed, then close.
    const distance = Math.max(height, window.innerHeight) + 24
    const duration = dismissDuration(distance - delta, velocity)
    sheet.style.transition = `translate ${duration}ms cubic-bezier(0.2, 0.7, 0.3, 1)`
    sheet.style.translate = `0 ${distance}px`
    later(duration, () => {
      onDismissRef.current()
      // If the owner kept the sheet mounted (e.g. it refused to close), put it back.
      window.requestAnimationFrame(() => window.requestAnimationFrame(clearStyles))
    })
  }, [clearStyles, later, sheetRef, snapBack])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
      if (startRef.current?.pointerId === event.pointerId) snapBack()
    },
    style: { touchAction: "none" as const },
  }
}
