import test from "node:test"
import assert from "node:assert/strict"
import { buildBinderSharePath, buildBinderShareUrl } from "../lib/binder-share"

test("buildBinderSharePath builds the read-only share route", () => {
  assert.equal(buildBinderSharePath("abc123"), "/app/share/abc123")
})

test("buildBinderShareUrl joins the origin and share path", () => {
  assert.equal(buildBinderShareUrl("https://holofolder.com", "abc123"), "https://holofolder.com/app/share/abc123")
  assert.equal(buildBinderShareUrl("https://holofolder.com/", "abc123"), "https://holofolder.com/app/share/abc123")
  assert.equal(buildBinderShareUrl("http://localhost:3000/some/page", "t"), "http://localhost:3000/app/share/t")
})
