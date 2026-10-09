import test from "node:test"
import assert from "node:assert/strict"
import { buildBinderSharePath, buildBinderShareUrl } from "../lib/binder-share"

test("buildBinderSharePath builds the read-only share route", () => {
  assert.equal(buildBinderSharePath("abc123"), "/share/abc123")
})

test("buildBinderShareUrl joins the origin and share path", () => {
  assert.equal(buildBinderShareUrl("https://binder.cal.gg", "abc123"), "https://binder.cal.gg/share/abc123")
  assert.equal(buildBinderShareUrl("https://binder.cal.gg/", "abc123"), "https://binder.cal.gg/share/abc123")
  assert.equal(buildBinderShareUrl("http://localhost:3000/some/page", "t"), "http://localhost:3000/share/t")
})
