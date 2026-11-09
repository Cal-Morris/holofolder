import { test } from "node:test"
import assert from "node:assert/strict"
import { activityActor, normalizeActivityScope, activityChanges, parseActivityPage, activityCacheKey, readActivityCache, writeActivityCache, clearActivityCache } from "../lib/collection-activity"

// All histories and identities in this file are synthetic.
const event = { id: "9223372036854775807", recorded_at: "2026-11-09T12:00:00Z", format_version: 1, actor_kind: "unknown", source: "unknown", action: "collection_change", affected_entities: {}, changes: [] }
test("provenance never fabricates profiles and bigint IDs stay strings", () => {
  assert.equal(activityActor(event), "Unknown")
  assert.equal(activityActor({ ...event, actor_kind: "system", actor_job: "price-refresh" }), "System · price-refresh")
  assert.equal(activityActor({ ...event, actor_kind: "user", actor_user_id: "retained-account" }), "Account retained-account")
  assert.equal(parseActivityPage({ data: [event], nextCursor: null })?.data[0].id, event.id)
  assert.equal(parseActivityPage({ data: [{ ...event, id: 9223372036854775807 }], nextCursor: null }), null)
})
test("ownership removal, unassignment, legacy wants and bulk changes are distinct", () => {
  const changes = activityChanges({ ...event, changes: [
    { table: "inventory_items", id: "copy-a", before: { card_id: "base1-4", grade: "9" }, after: null },
    { table: "inventory_placements", id: "copy-b", before: { inventory_item_id: "copy-b", slot_id: "slot-a" }, after: null },
    { table: "pokemon_collection", id: "legacy", before: { status: "collected", wanted_cards: [] }, after: { status: "uncollected", wanted_cards: [{ card_id: "base1-4" }] } },
  ] })
  assert.match(changes[0].title, /Ownership removed/)
  assert.match(changes[1].title, /Unassigned/)
  assert.match(JSON.stringify(changes[2]), /Wanted cards/)
  assert.equal(activityChanges({ ...event, format_version: 0, pokemon_name: "Synthetic", before_state: { status: "collected" }, after_state: { status: "uncollected" } }).length, 1)
})
test("cache rejects account/owner/membership changes and stale async writers", () => {
  const values = new Map<string,string>()
  const storage = { getItem: (k:string) => values.get(k) ?? null, setItem: (k:string,v:string) => { values.set(k,v) }, removeItem: (k:string) => { values.delete(k) } }
  const scope = { accountId: "actor", ownerId: "owner", membershipKey: "membership-a" }
  const key = activityCacheKey(scope, "collection=a")
  const page = { data: [event], nextCursor: "cursor" }
  storage.setItem("holofolder_activity_scope_v1", JSON.stringify(scope))
  assert.equal(writeActivityCache(storage, scope, key, page, "2026-11-09T12:00:00Z"), true)
  assert.equal(readActivityCache(storage, scope, key)?.page.nextCursor, "cursor")
  storage.setItem("holofolder_activity_scope_v1", JSON.stringify({ ...scope, membershipKey: "membership-b" }))
  assert.equal(readActivityCache(storage, scope, key), null)
  assert.equal(writeActivityCache(storage, scope, key, page, "now"), false)
  clearActivityCache(storage)
  assert.equal(readActivityCache(storage, scope, key), null)
})
test("only allowlisted read fields survive parsing private or cached payloads", () => {
  const page = parseActivityPage({ data: [{ ...event, recovery_state: { secret: "private-cert" }, changes: [{ table: "inventory_items", id: "copy", before: { card_id: "base1-4", private_cert: "private-cert", label_asset: "private-art", grade: "9" }, after: null }] }], nextCursor: null })!
  assert.ok(!JSON.stringify(page).includes("private-cert"))
  assert.ok(!JSON.stringify(page).includes("private-art"))
  assert.equal(page.data[0].changes[0].before?.grade, "9")
})
test("ownership and placement removed together never claims ownership was retained",()=>{
  const changes=activityChanges({...event,changes:[
    {table:'inventory_items',id:'same-copy',before:{identity:{cardId:'base1-4'}},after:null},
    {table:'inventory_placements',id:'same-copy',before:{inventory_item_id:'same-copy',slot_id:'a'},after:null},
  ]})
  assert.doesNotMatch(changes[1].title,/ownership retained/)
})

test("current people labels stay readable without inventing historical names", () => {
  const user = { actor_kind: "user", actor_user_id: "current-account" }
  assert.equal(activityActor(user, "current-account", ["current-account", "linked-partner"]), "You")
  assert.equal(activityActor({ ...user, actor_user_id: "linked-partner" }, "current-account", ["current-account", "linked-partner"]), "Collection partner")
  assert.equal(activityActor({ ...user, actor_user_id: "old-member" }, "current-account", ["current-account", "linked-partner"]), "Account old-member")
})

test("untrusted current-member metadata is normalized before rendering or caching", () => {
  const scope = { accountId: "current-account", ownerId: "current-account", membershipKey: "verified" }
  assert.equal(normalizeActivityScope({ ...scope, memberIds: "not-an-array" }), null)
  assert.equal(normalizeActivityScope({ ...scope, memberIds: [42] }), null)
  assert.deepEqual(normalizeActivityScope({ ...scope, memberIds: ["current-account"] })?.memberIds, ["current-account"])
})
