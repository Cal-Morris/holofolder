"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { OverlayStack, shouldDismissSwipe } from "@/lib/overlay-stack"

const stack = new OverlayStack()
const OVERLAY_HISTORY_KEY = "__binderdexOverlay"
let scrollLockCount = 0
let savedBodyOverflow = ""
let savedHtmlOverflow = ""

// History bookkeeping shared by all overlays. Closing overlays programmatically pops their
// history entries in one batched history.go(-n); pushes requested while that traversal is
// still pending are deferred until it lands so entries never get out of order.
let ignoredPopstates = 0
let queuedBacks = 0
let backFlushScheduled = false
let lastPopstateIgnored = false
const deferredPushes: Array<() => void> = []
let globalPopstateListenerInstalled = false

function installGlobalPopstateListener() {
  if (globalPopstateListenerInstalled || typeof window === "undefined") return
  globalPopstateListenerInstalled = true
  window.addEventListener("popstate", () => {
    if (ignoredPopstates > 0) {
      ignoredPopstates -= 1
      lastPopstateIgnored = true
      if (ignoredPopstates === 0) {
        const pushes = deferredPushes.splice(0)
        pushes.forEach((push) => push())
      }
      return
    }
    lastPopstateIgnored = false
  })
}

function requestHistoryBack() {
  queuedBacks += 1
  if (backFlushScheduled) return
  backFlushScheduled = true
  queueMicrotask(() => {
    backFlushScheduled = false
    const count = queuedBacks
    queuedBacks = 0
    if (count <= 0) return
    ignoredPopstates += 1
    window.history.go(-count)
  })
}

function requestHistoryPush(push: () => void) {
  if (ignoredPopstates > 0 || queuedBacks > 0 || backFlushScheduled) {
    deferredPushes.push(push)
    return
  }
  push()
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

function lockScroll() {
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow
    savedHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = "hidden"
    document.documentElement.style.overflow = "hidden"
  }
  scrollLockCount += 1
}

function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow
    document.documentElement.style.overflow = savedHtmlOverflow
  }
}

/**
 * Run a navigation once the history entries of overlays that just closed are popped, so the back traversal
 * can't undo it. Call it after the closing render has committed (e.g. from an effect).
 */
export function runAfterOverlayHistory(navigate: () => void) {
  if (typeof window === "undefined") return
  installGlobalPopstateListener()
  requestHistoryPush(navigate)
}

/** Close every open overlay (used when switching main views/tabs). */
/** Number of overlays currently open (re-renders when it changes). */
export function useOpenOverlayCount() {
  return useSyncExternalStore(
    (listener) => stack.subscribe(listener),
    () => stack.size,
    () => 0,
  )
}

export function closeAllOverlays() {
  stack.closeAll()
}

export interface UseOverlayOptions {
  /** Element that contains the overlay content; used for focus trap and initial focus. */
  containerRef?: RefObject<HTMLElement | null>
  /** Lock page scroll while open (default true). */
  lockScroll?: boolean
  /** Trap Tab focus inside the container and restore focus on close (default true). */
  trapFocus?: boolean
  /** Push a history entry so the browser/Android back button closes the overlay (default true). */
  history?: boolean
  /** Move focus into the overlay when it opens (default true). */
  autoFocus?: boolean
}

let lastPressedControl: HTMLElement | null = null
let focusOriginTrackerInstalled = false

/** Remembers the last focusable control the user pressed, used to return focus on close. */
function installFocusOriginTracker() {
  if (focusOriginTrackerInstalled || typeof window === "undefined") return
  focusOriginTrackerInstalled = true
  const remember = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null
    const control = target?.closest<HTMLElement>(FOCUSABLE_SELECTOR) ?? null
    if (control) lastPressedControl = control
  }
  window.addEventListener("pointerdown", remember, true)
  window.addEventListener("keydown", remember, true)
}

// Track from page load so the very first overlay also knows which control opened it.
installFocusOriginTracker()

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
  } = options
  const onCloseRef = useRef(onClose)
  // Options that may change while the overlay is open are read through a ref so that toggling
  // them never re-registers the overlay (which would reorder the stack and the history entries).
  const liveOptionsRef = useRef({ containerRef, trapFocus, autoFocus })
  useLayoutEffect(() => {
    onCloseRef.current = onClose
    liveOptionsRef.current = { containerRef, trapFocus, autoFocus }
  })

  const isScrollLocked = open && shouldLockScroll
  useEffect(() => {
    if (!isScrollLocked || typeof window === "undefined") return
    lockScroll()
    return unlockScroll
  }, [isScrollLocked])

  useEffect(() => {
    if (!open || typeof window === "undefined") return
    const { containerRef, autoFocus } = liveOptionsRef.current

    installFocusOriginTracker()
    // An `autoFocus` field inside the overlay may already have taken focus by the time effects
    // run, so fall back to the control the user last pressed to open it.
    const activeAtOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const openedContainer = containerRef?.current ?? null
    const isOutside = (element: HTMLElement | null) =>
      Boolean(element && element !== document.body && !(openedContainer && openedContainer.contains(element)))
    const previouslyFocused = isOutside(activeAtOpen) ? activeAtOpen : isOutside(lastPressedControl) ? lastPressedControl : null
    let closedByHistory = false
    let historyEntryPushed = false
    let disposed = false

    installGlobalPopstateListener()
    const entry = stack.push(() => onCloseRef.current())

    if (useHistory) {
      requestHistoryPush(() => {
        if (disposed) return
        const currentState = window.history.state && typeof window.history.state === "object" ? window.history.state : {}
        window.history.pushState({ ...currentState, [OVERLAY_HISTORY_KEY]: entry.id }, "")
        historyEntryPushed = true
      })
    }

    const handlePopState = () => {
      if (lastPopstateIgnored) return
      if (!historyEntryPushed || !stack.isTop(entry.id)) return
      closedByHistory = true
      onCloseRef.current()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!stack.isTop(entry.id)) return

      if (event.key === "Escape") {
        // Let an open Radix select/menu/popover close itself first.
        if (document.querySelector("[data-radix-popper-content-wrapper]")) return
        const target = event.target as HTMLElement | null
        // Let inputs that use Escape to clear themselves do so first.
        if (target?.dataset?.overlayEscape === "clear" && "value" in target && (target as HTMLInputElement).value) {
          return
        }
        event.preventDefault()
        event.stopImmediatePropagation()
        onCloseRef.current()
        return
      }

      if (event.key === "Tab" && liveOptionsRef.current.trapFocus) {
        const container = liveOptionsRef.current.containerRef?.current
        if (!container) return
        const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
          .filter((element) => element.offsetParent !== null || element === document.activeElement)
        if (focusable.length === 0) {
          event.preventDefault()
          container.focus()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement as HTMLElement | null
        if (event.shiftKey && (active === first || !container.contains(active))) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (active === last || !container.contains(active))) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener("popstate", handlePopState)
    window.addEventListener("keydown", handleKeyDown, true)

    let focusFrame = 0
    if (autoFocus && containerRef) {
      focusFrame = window.requestAnimationFrame(() => {
        const container = containerRef.current
        if (!container || container.contains(document.activeElement)) return
        if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1")
        container.focus({ preventScroll: true })
      })
    }

    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener("popstate", handlePopState)
      window.removeEventListener("keydown", handleKeyDown, true)
      stack.remove(entry.id)

      disposed = true
      if (historyEntryPushed && !closedByHistory) {
        requestHistoryBack()
      }

      if (liveOptionsRef.current.trapFocus && previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [open, useHistory])
}

/**
 * Swipe-down-to-dismiss for bottom sheets. Spread the returned handlers on the grabber/header.
 * The sheet element follows the finger and closes once dragged far/fast enough.
 */
export function useSwipeToDismiss(sheetRef: RefObject<HTMLElement | null>, onDismiss: () => void, enabled = true) {
  const startRef = useRef<{ y: number; time: number; pointerId: number } | null>(null)
  const deltaRef = useRef(0)

  const reset = useCallback(() => {
    const sheet = sheetRef.current
    if (sheet) {
      sheet.style.transition = "transform 180ms ease-out"
      sheet.style.translate = ""
      window.setTimeout(() => {
        if (sheetRef.current) sheetRef.current.style.transition = ""
      }, 200)
    }
    startRef.current = null
    deltaRef.current = 0
  }, [sheetRef])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest("button, a, input, select, textarea, [data-no-swipe]")) return
    startRef.current = { y: event.clientY, time: performance.now(), pointerId: event.pointerId }
    deltaRef.current = 0
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [enabled])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = startRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const delta = Math.max(0, event.clientY - start.y)
    deltaRef.current = delta
    const sheet = sheetRef.current
    if (sheet) {
      sheet.style.transition = "none"
      sheet.style.translate = `0 ${delta}px`
    }
  }, [sheetRef])

  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = startRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const shouldDismiss = shouldDismissSwipe(deltaRef.current, performance.now() - start.time)
    if (shouldDismiss) {
      startRef.current = null
      deltaRef.current = 0
      onDismiss()
      return
    }
    reset()
  }, [onDismiss, reset])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: reset,
    style: { touchAction: "none" as const },
  }
}
