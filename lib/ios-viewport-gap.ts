// iOS 26 installed web apps (black-translucent status bar) can get a web view that starts under the
// status bar but is as many points short at the bottom as the status bar is tall: innerHeight and
// 100dvh are the screen height minus env(safe-area-inset-top), and the leftover band below the page
// takes no layout or taps (WebKit bug 313800). The page can't draw into that band, but the band
// already keeps the dock clear of the home indicator, so the dock's own safe-area padding is
// double-counted there. This measures the band as --ios-viewport-gap so the dock (see --dock-inset in
// app/globals.css) can drop the duplicate padding and sit lower, still inside the tappable area.
//
// It only reports a gap for that exact signature (installed app, full-width view, the missing height
// equals the top inset), so browser tabs, Android, older iOS and a correctly sized view are untouched.

export interface ViewportMetrics {
  standalone: boolean
  screenWidth: number
  screenHeight: number
  innerWidth: number
  innerHeight: number
  insetTop: number
}

/** Height in CSS px of the dead band under the page, or 0 when the view fills the screen. */
export function iosViewportGap(m: ViewportMetrics): number {
  if (!m.standalone || m.insetTop < 20) return 0
  const portrait = m.innerHeight >= m.innerWidth
  const long = Math.max(m.screenWidth, m.screenHeight)
  const short = Math.min(m.screenWidth, m.screenHeight)
  const fullWidth = portrait ? short : long
  const fullHeight = portrait ? long : short
  if (Math.abs(fullWidth - m.innerWidth) > 2) return 0
  const missing = Math.round(fullHeight - m.innerHeight)
  return missing >= 20 && Math.abs(missing - m.insetTop) <= 4 ? missing : 0
}

/** Runs in the page (inline, before first paint) with iosViewportGap passed in. */
function install(gapFor: (m: ViewportMetrics) => number) {
  try {
    const root = document.documentElement
    const measure = () => {
      const probe = document.createElement("div")
      probe.style.cssText = "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)"
      root.appendChild(probe)
      const insetTop = parseFloat(getComputedStyle(probe).paddingTop) || 0
      probe.remove()
      const nav = navigator as Navigator & { standalone?: boolean }
      const gap = gapFor({
        standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
        screenWidth: screen.width,
        screenHeight: screen.height,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        insetTop,
      })
      if (gap > 0) root.style.setProperty("--ios-viewport-gap", `${gap}px`)
      else root.style.removeProperty("--ios-viewport-gap")
      root.dataset.iosViewportGap = String(gap)
    }
    measure()
    for (const type of ["resize", "orientationchange", "pageshow"]) window.addEventListener(type, measure)
    window.visualViewport?.addEventListener("resize", measure)
  } catch {
    // Never let layout tuning break the page.
  }
}

export const IOS_VIEWPORT_GAP_SCRIPT = `(${install.toString()})(${iosViewportGap.toString()})`
