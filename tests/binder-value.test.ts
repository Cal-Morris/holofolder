import { test } from "node:test"
import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { BinderValue } from "../components/binder-value"

test("binder value exposes separate open and dismiss buttons, without nesting controls", () => {
  const markup = renderToStaticMarkup(createElement(BinderValue, { collection: [], prices: {}, loading: false, onOpen() {}, onDismiss() {} }))
  assert.match(markup, /aria-label="View binder value in Analytics"/)
  assert.match(markup, /aria-label="Hide binder value"/)
  assert.equal((markup.match(/<button\b/g) ?? []).length, 2)
  assert.match(markup, /<\/button>\s*<button[^>]+aria-label="Hide binder value"/)
  assert.doesNotMatch(markup, /£0/)
})
