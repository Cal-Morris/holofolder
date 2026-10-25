"use client"

import { useEffect } from "react"
import { createScrollFreeze, SCROLLING_ATTRIBUTE } from "@/lib/scroll-blur-freeze"

/**
 * Marks the document as scrolling while any scroller (the page or a view list) moves, so the
 * `[data-scroll-blur]` surfaces drop their backdrop blur until scrolling settles. See
 * lib/scroll-blur-freeze.ts.
 */
export function useFreezeBlurOnScroll() {
  useEffect(() => {
    const root = document.documentElement
    const freeze = createScrollFreeze({
      freeze: () => root.setAttribute(SCROLLING_ATTRIBUTE, ""),
      unfreeze: () => root.removeAttribute(SCROLLING_ATTRIBUTE),
    })
    // Scroll events do not bubble, so listen in the capture phase to hear nested scrollers too.
    const options = { capture: true, passive: true } as const
    document.addEventListener("scroll", freeze.onScroll, options)
    document.addEventListener("scrollend", freeze.onScrollEnd, options)
    return () => {
      document.removeEventListener("scroll", freeze.onScroll, options)
      document.removeEventListener("scrollend", freeze.onScrollEnd, options)
      freeze.dispose()
    }
  }, [])
}
