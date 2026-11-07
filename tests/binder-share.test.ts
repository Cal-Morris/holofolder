import test from "node:test"
import assert from "node:assert/strict"
import { buildBinderSharePath, buildBinderShareUrl, publicCollectionItems } from "../lib/binder-share"

test("buildBinderSharePath builds the read-only share route", () => {
  assert.equal(buildBinderSharePath("abc123"), "/app/share/abc123")
})

test("buildBinderShareUrl joins the origin and share path", () => {
  assert.equal(buildBinderShareUrl("https://holofolder.com", "abc123"), "https://holofolder.com/app/share/abc123")
  assert.equal(buildBinderShareUrl("https://holofolder.com/", "abc123"), "https://holofolder.com/app/share/abc123")
  assert.equal(buildBinderShareUrl("http://localhost:3000/some/page", "t"), "http://localhost:3000/app/share/t")
})

test("share URLs accept server paths and keep named production addresses canonical", () => {
  assert.equal(buildBinderShareUrl("https://holofolder.com", "/@cal/national"), "https://holofolder.com/@cal/national")
  assert.equal(buildBinderShareUrl("https://app.holofolder.com", "/@cal/national"), "https://holofolder.com/@cal/national")
  assert.equal(buildBinderShareUrl("http://localhost:3441", "/@cal/national"), "http://localhost:3441/app/u/cal/national")
  assert.equal(buildBinderShareUrl("https://preview.vercel.app", "/@cal/national"), "https://preview.vercel.app/app/u/cal/national")
  assert.equal(buildBinderShareUrl("https://holofolder.com", "/app/share/abc123"), "https://holofolder.com/app/share/abc123")
  assert.throws(() => buildBinderShareUrl("https://holofolder.com", "//example.com/private"))
  assert.throws(() => buildBinderShareUrl("https://holofolder.com", "/@cal/../private"))
})

test("public collection data excludes database metadata and partner identities", () => {
  const rows = [{ id: "synthetic-row", pokemon_id: 1, pokemon_name: "synthetic", user_id: "private-owner", binder_id: "private-binder", private_note: "not public", wanted_cards: [{ card_id: "synthetic-card", card_name: "Synthetic card", added_at: "2026-01-01T00:00:00Z", wanted_by: ["private-partner"] }] }]
  const result = publicCollectionItems(rows)
  assert.equal(result[0].pokemon_id, 1)
  assert.equal(result[0].wanted_cards[0].card_id, "synthetic-card")
  assert.equal("user_id" in result[0], false)
  assert.equal("private_note" in result[0], false)
  assert.equal("wanted_by" in result[0].wanted_cards[0], false)
})
