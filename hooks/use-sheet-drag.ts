"use client"

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { bodyMoveDragsSheet, dismissDuration, dragOffset, releaseVelocity, shouldDismissDrag, dragDistanceForOffset, type DragSample } from "@/lib/sheet-drag"
import { canScrollAlong } from "@/lib/touch-scroll-guard"

const SNAP_BACK = "translate 260ms cubic-bezier(0.22, 1.2, 0.36, 1)"
const MAX_SAMPLES = 12
/** Gesture id for a body drag; pointer ids are never negative. */
const BODY_GESTURE = -1
/** Touches on these never drag the sheet from its body (the grabber has its own pointer handlers). */
const NO_BODY_DRAG = "[data-sheet-grabber], input, select, textarea, [contenteditable=''], [contenteditable='true'], [data-no-swipe], [data-allow-touch-scroll]"

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

/** Innermost vertical scroller between the touched element and the sheet (inclusive). */
function verticalScroller(target: Element, sheet: HTMLElement) {
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node)
      const box = { overflowX: style.overflowX, overflowY: style.overflowY, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }
      if (canScrollAlong(box, 0, 1)) return node
    }
    if (node === sheet) break
  }
  return null
}

// Nested sheets (e.g. the card selector over the card detail) each listen on the document;
// the innermost sheet under the finger owns the touch.
let bodyTouchEvent: TouchEvent | null = null
let bodyTouchOwner: HTMLElement | null = null

/**
 * Drag a bottom sheet down to dismiss it. The sheet follows the finger, rubber-bands when
 * pulled up, and on release either snaps back or slides out at the release velocity before
 * `onDismiss` runs. Spread the returned props on the grabber/header element: it always drags.
 * On touch screens a downward pull on the rest of the sheet also drags it while its content
 * is scrolled to the top; otherwise the content scrolls (decided once per gesture).
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

  const start = useCallback((y: number, time: number, pointerId: number) => {
    const sheet = sheetRef.current
    const translate = sheet ? getComputedStyle(sheet).translate.split(" ") : []
    // A modal centred with its own translate (wider screens) stays put rather than jumping.
    if (sheet && timerRef.current === null && !sheet.style.translate && translate.some(value => Number.parseFloat(value))) return false
    // Catch a sheet that is still snapping back: stop the animation where it is.
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const offset = Number.parseFloat(translate[1] ?? "0") || 0
    // Undo rubber-banding so the first move resumes at the visible position.
    const rawOffset = dragDistanceForOffset(offset)
    if (sheet) {
      sheet.style.transition = "none"
      sheet.style.translate = `0 ${offset}px`
    }
    startRef.current = { y: y - rawOffset, pointerId }
    samplesRef.current = [{ y, time }]
    deltaRef.current = rawOffset
    return true
  }, [sheetRef])

  const move = useCallback((y: number, time: number, pointerId: number) => {
    const start = startRef.current
    if (!start || start.pointerId !== pointerId) return
    const delta = y - start.y
    deltaRef.current = delta
    const samples = samplesRef.current
    samples.push({ y, time })
    if (samples.length > MAX_SAMPLES) samples.shift()
    const sheet = sheetRef.current
    if (sheet) {
      sheet.dataset.sheetDragging = ""
      sheet.style.transition = "none"
      sheet.style.translate = `0 ${dragOffset(delta)}px`
    }
  }, [sheetRef])

  const release = useCallback((time: number, pointerId: number) => {
    const start = startRef.current
    if (!start || start.pointerId !== pointerId) return
    const delta = deltaRef.current
    const velocity = releaseVelocity(samplesRef.current, time)
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

  // Body drags use touch events: a pointer drag on scrollable content gets cancelled the
  // moment the browser starts panning, but a cancelled first touchmove never pans.
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return
    let touch: { id: number; x: number; y: number; scroller: HTMLElement | null; dragging: boolean | null } | null = null

    const find = (list: TouchList, id: number) => Array.from(list).find(item => item.identifier === id)

    const onTouchStart = (event: TouchEvent) => {
      if (bodyTouchEvent !== event) {
        bodyTouchEvent = event
        bodyTouchOwner = null
      }
      const sheet = sheetRef.current
      const target = event.target instanceof Element ? event.target : null
      if (touch?.dragging) {
        // A second finger: stay with the first one.
        return
      }
      touch = null
      if (event.touches.length !== 1 || !sheet || !target || !sheet.contains(target) || target.closest(NO_BODY_DRAG)) return
      if (bodyTouchOwner && !bodyTouchOwner.contains(sheet)) return
      bodyTouchOwner = sheet
      const point = event.touches[0]
      touch = { id: point.identifier, x: point.clientX, y: point.clientY, scroller: verticalScroller(target, sheet), dragging: null }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!touch || bodyTouchOwner !== sheetRef.current) return
      const point = find(event.changedTouches, touch.id)
      if (!point) return
      if (touch.dragging === null) {
        const dx = point.clientX - touch.x
        const dy = point.clientY - touch.y
        if (dx === 0 && dy === 0) return
        touch.dragging = event.cancelable && !startRef.current && bodyMoveDragsSheet(dx, dy, touch.scroller?.scrollTop ?? 0)
          && start(touch.y, event.timeStamp || performance.now(), BODY_GESTURE)
      }
      if (!touch.dragging) return
      event.preventDefault()
      move(point.clientY, event.timeStamp || performance.now(), BODY_GESTURE)
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (!touch || !find(event.changedTouches, touch.id)) return
      const dragged = touch.dragging
      touch = null
      if (!dragged) return
      if (event.type === "touchcancel") {
        if (startRef.current?.pointerId === BODY_GESTURE) snapBack()
        return
      }
      // The finger moved, so the button it started on must not fire.
      const swallow = (click: Event) => {
        click.stopPropagation()
        click.preventDefault()
      }
      window.addEventListener("click", swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400)
      release(event.timeStamp || performance.now(), BODY_GESTURE)
    }

    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true })
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false })
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: true })
    document.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: true })
    return () => {
      document.removeEventListener("touchstart", onTouchStart, { capture: true })
      document.removeEventListener("touchmove", onTouchMove, { capture: true })
      document.removeEventListener("touchend", onTouchEnd, { capture: true })
      document.removeEventListener("touchcancel", onTouchEnd, { capture: true })
    }
  }, [enabled, move, release, sheetRef, snapBack, start])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0 || startRef.current) return
    const target = event.target as HTMLElement
    if (target.closest("button, a, input, select, textarea, [data-no-swipe]")) return
    if (!start(event.clientY, event.timeStamp || performance.now(), event.pointerId)) return
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Pointer already gone (e.g. released during the same frame); the drag still works uncaptured.
    }
  }, [enabled, start])

  return {
    onPointerDown,
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => move(event.clientY, event.timeStamp || performance.now(), event.pointerId),
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => release(event.timeStamp || performance.now(), event.pointerId),
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
      if (startRef.current?.pointerId === event.pointerId) snapBack()
    },
    style: { touchAction: "none" as const },
  }
}
