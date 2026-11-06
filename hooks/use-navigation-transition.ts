"use client"

import { useCallback, useEffect, useRef } from "react"
import { flushSync } from "react-dom"
import { PAGE_TURN_EASING, PAGE_TURN_MS } from "@/lib/binder-page-turn"

export function useNavigationTransition(reducedMotion: boolean) {
  const active = useRef<{ cancel: () => void } | null>(null)
  useEffect(() => () => active.current?.cancel(), [])

  return useCallback((element: HTMLElement | null, update: () => void, direction?: "left" | "right") => {
    active.current?.cancel()
    active.current = null
    // React's preference update may still be pending on the first click.
    if (!element || reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update()
      return
    }

    // Page turns must commit before snapshot capture can stall input and scrolling.
    // Keep the live grid interactive; snapshots are only useful for switching views.
    if (direction || !document.startViewTransition) {
      flushSync(update)
      const animation = element.animate([
        { opacity: 0.85 },
        { opacity: 1 },
      ], { duration: PAGE_TURN_MS, easing: PAGE_TURN_EASING })
      active.current = { cancel: () => animation.cancel() }
      return
    }

    const root = document.documentElement
    root.dataset.binderMotion = direction ?? "tab"
    element.style.viewTransitionName = "binder-content"
    let cancelled = false
    const clear = () => {
      element.style.viewTransitionName = ""
      delete root.dataset.binderMotion
    }
    const transition = document.startViewTransition(async () => {
      // A skipped transition still runs its callback; never apply a superseded navigation.
      if (!cancelled) {
        flushSync(update)
        // Rendering is paused during snapshot capture; yield a task for lazy content, not a frame.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    })
    void transition.ready.catch(() => {})
    const current = { cancel: () => { cancelled = true; transition.skipTransition(); clear() } }
    active.current = current
    void transition.finished.finally(() => {
      if (active.current === current) {
        clear()
        active.current = null
      }
    }).catch(() => {})
  }, [reducedMotion])
}
