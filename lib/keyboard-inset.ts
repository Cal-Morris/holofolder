// On-screen keyboard avoidance. iOS Safari (tab and installed app) and Chrome on Android open the
// keyboard over the page without shrinking the layout viewport: only window.visualViewport gets
// shorter. Anything pinned to the bottom (the dock, sheet footers, Show mode's search bar) then sits
// under the keyboard. While a text field is focused and the keyboard covers part of the page, this
// sets --keyboard-inset (the covered height) and html[data-keyboard-open]; app/globals.css turns
// that into the bottom inset for sheets and footers and hides the dock until the keyboard closes.
//
// Browser toolbars collapsing and a hardware keyboard's shortcut bar also shorten the visual
// viewport, so a small change or one with nothing to type into is ignored.

export interface KeyboardMetrics {
  /** window.innerHeight: the layout viewport, which the keyboard doesn't resize. */
  innerHeight: number
  /** visualViewport.height and offsetTop: the part of the page still visible above the keyboard. */
  viewportHeight: number
  offsetTop: number
  /** visualViewport.scale: a pinch zoom shrinks the visual viewport too. */
  scale: number
  /** A text field (or other editable element) has focus. */
  editableFocused: boolean
}

/** Smallest covered height treated as a software keyboard (a toolbar or shortcut bar is shorter). */
export const KEYBOARD_MIN_INSET = 120

/** Height in CSS px of the page hidden under the on-screen keyboard, or 0 when it is closed. */
export function keyboardInset(m: KeyboardMetrics): number {
  if (!m.editableFocused || Math.abs(m.scale - 1) > 0.01) return 0
  const covered = Math.round(m.innerHeight - m.viewportHeight - Math.max(m.offsetTop, 0))
  // 120 = KEYBOARD_MIN_INSET, written out because this function is also serialised into the page.
  return covered >= 120 ? covered : 0
}

/** Elements that raise the keyboard (inputmode="none" fields, like the deal keypad, don't). */
export function isKeyboardTarget(element: Element | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  if (element.getAttribute("inputmode") === "none") return false
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled
  if (element instanceof HTMLInputElement) {
    const nonText = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]
    return !nonText.includes(element.type) && !element.readOnly && !element.disabled
  }
  return false
}

/** Runs in the page (inline, before first paint) with the helpers passed in. */
function install(insetFor: (m: KeyboardMetrics) => number, isTarget: (element: Element | null) => boolean) {
  try {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    let current = 0
    let frame = 0
    const apply = () => {
      frame = 0
      const focused = document.activeElement
      const inset = insetFor({
        innerHeight: window.innerHeight,
        viewportHeight: vv.height,
        offsetTop: vv.offsetTop,
        scale: vv.scale,
        editableFocused: isTarget(focused),
      })
      if (inset === current) return
      const opening = current === 0
      current = inset
      if (inset > 0) {
        root.style.setProperty("--keyboard-inset", `${inset}px`)
        root.dataset.keyboardOpen = ""
      } else {
        root.style.removeProperty("--keyboard-inset")
        delete root.dataset.keyboardOpen
      }
      // Once the layout has made room, bring a field the keyboard still covers back into view.
      if (inset > 0 && opening && focused instanceof HTMLElement) {
        requestAnimationFrame(() => {
          if (document.activeElement !== focused) return
          if (focused.getBoundingClientRect().bottom > window.innerHeight - inset) focused.scrollIntoView({ block: "nearest" })
        })
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply)
    }
    vv.addEventListener("resize", schedule)
    vv.addEventListener("scroll", schedule)
    // focusout fires before focus lands on the next field, so wait a frame before deciding.
    document.addEventListener("focusin", schedule)
    document.addEventListener("focusout", schedule)
    window.addEventListener("pageshow", schedule)
  } catch {
    // Never let layout tuning break the page.
  }
}

export const KEYBOARD_INSET_SCRIPT = `(${install.toString()})(${keyboardInset.toString()}, ${isKeyboardTarget.toString()})`
