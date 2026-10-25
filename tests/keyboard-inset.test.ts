import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { KEYBOARD_INSET_SCRIPT, KEYBOARD_MIN_INSET, keyboardInset } from "@/lib/keyboard-inset"

// iPhone 15 in Safari with the keyboard up: 844pt layout viewport, 336pt keyboard + accessory bar.
const open = { innerHeight: 844, viewportHeight: 508, offsetTop: 0, scale: 1, editableFocused: true }

describe("keyboardInset", () => {
  test("is the height the keyboard covers while a field is focused", () => {
    assert.equal(keyboardInset(open), 336)
  })
  test("leaves out the part iOS scrolled the page up by to reveal the field", () => {
    assert.equal(keyboardInset({ ...open, offsetTop: 120 }), 216)
  })
  test("is 0 with nothing to type into (toolbar changes, a field just blurred)", () => {
    assert.equal(keyboardInset({ ...open, editableFocused: false }), 0)
  })
  test("ignores small changes: collapsing toolbars or a hardware keyboard's shortcut bar", () => {
    assert.equal(keyboardInset({ ...open, viewportHeight: 844 - 70 }), 0)
    assert.equal(keyboardInset({ ...open, viewportHeight: 844 - (KEYBOARD_MIN_INSET - 1) }), 0)
    assert.equal(keyboardInset({ ...open, viewportHeight: 844 - KEYBOARD_MIN_INSET }), KEYBOARD_MIN_INSET)
  })
  test("is 0 while pinch-zoomed, where the visual viewport is smaller for another reason", () => {
    assert.equal(keyboardInset({ ...open, viewportHeight: 422, scale: 2 }), 0)
  })
  test("is 0 when the keyboard has closed", () => {
    assert.equal(keyboardInset({ ...open, viewportHeight: 844 }), 0)
  })
  test("never goes negative when the visual viewport is taller (overscroll)", () => {
    assert.equal(keyboardInset({ ...open, viewportHeight: 900, offsetTop: -20 }), 0)
  })
  test("the inline script is self-contained", () => {
    assert.match(KEYBOARD_INSET_SCRIPT, /^\(function|^\(\(/)
    assert.doesNotMatch(KEYBOARD_INSET_SCRIPT, /\b(require|import)\b/)
    assert.doesNotMatch(KEYBOARD_INSET_SCRIPT, /KEYBOARD_MIN_INSET/)
  })
})
