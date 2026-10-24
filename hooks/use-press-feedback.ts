"use client"

import { useEffect } from "react"

let installed = false

/**
 * iOS Safari only applies `:active` to elements while a touch is held if some touch listener
 * exists on the page. A single passive no-op listener on the document enables the shared
 * pressed styles in globals.css for every control without per-component wiring.
 */
export function usePressFeedback() {
  useEffect(() => {
    if (installed) return
    installed = true
    const noop = () => {}
    document.addEventListener("touchstart", noop, { passive: true })
  }, [])
}
