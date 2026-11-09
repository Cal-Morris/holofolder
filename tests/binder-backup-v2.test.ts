import { test } from "node:test"
import assert from "node:assert/strict"
import { createBinderBackupV2, parseBinderBackupV2 } from "@/lib/binder-backup-v2"

import { snapshot } from "./fixtures/binder-backup-v2"

test("v2 preserves ordered 1025 targets, spacers, repeat physical copies, wants and recorded grades", () => {
  const source = snapshot()
  const backup = createBinderBackupV2({ snapshot: source, completeness: "complete-owner", scope: "all-inventory" })
  assert.deepEqual(parseBinderBackupV2(JSON.stringify(backup)), backup)
  assert.equal(backup.binders[0].slots.length, 1028)
  assert.equal(backup.items.length, 4)
  assert.equal(backup.items[3].grading?.certificate, "0000123")
  assert.ok(!JSON.stringify(backup).includes("synthetic-owner"))
  source.items[3].grading!.certificate = "changed"
  assert.equal(backup.items[3].grading?.certificate, "0000123")
  assert.ok(Object.isFrozen(backup.binders[0].slots[0]))
})
test("collection-only includes referenced copies, all-inventory refuses incomplete snapshots", () => {
  assert.equal(createBinderBackupV2({ snapshot: snapshot(), completeness: "complete-owner", scope: "collection", collectionId: snapshot().collections[0].id }).items.length, 2)
  assert.throws(() => createBinderBackupV2({ snapshot: snapshot(), completeness: "partial", scope: "all-inventory" }), /complete/)
})
test("malformed, future, duplicate, dangling, credential and asset input fails closed", () => {
  const backup = createBinderBackupV2({ snapshot: snapshot(), completeness: "complete-owner", scope: "all-inventory" })
  for (const alter of [
    (b: typeof backup) => { b.version = 99 as 2 },
    (b: typeof backup) => { b.items.push(b.items[0]) },
    (b: typeof backup) => { b.placements[0].inventoryItemId = "missing" },
    (b: typeof backup) => { b.items[0].grading = { ...b.items[3].grading!, label: { variant: null, assetIds: ["https://private.invalid/secret"] } } },
    (b: typeof backup) => { Object.assign(b, { ownerUserId: "secret" }) },
  ]) { const changed = structuredClone(backup); alter(changed); assert.throws(() => parseBinderBackupV2(JSON.stringify(changed))) }
  assert.throws(() => parseBinderBackupV2(" ".repeat(10 * 1024 * 1024 + 1)), /10 MiB/)
})

test("wanted people use portable roles, never account IDs, and require trusted partner resolution", () => {
  const source = snapshot()
  source.ownerUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  source.collections.forEach(c => { c.ownerUserId = source.ownerUserId })
  source.items.forEach(i => { i.ownerUserId = source.ownerUserId })
  source.binders.forEach(b => { b.ownerUserId = source.ownerUserId; b.slots.forEach(s => { s.ownerUserId = source.ownerUserId }) })
  const partner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  source.binders[0].slots[3].wantedCards[0].wanted_by = [source.ownerUserId, partner]
  assert.throws(() => createBinderBackupV2({ snapshot: source, completeness: "complete-owner", scope: "all-inventory" }), /membership/)
  const backup = createBinderBackupV2({ snapshot: source, partnerUserId: partner, completeness: "complete-owner", scope: "all-inventory" })
  assert.deepEqual(backup.binders[0].slots[3].wantedCards[0].wantedRoles, ["owner", "partner"])
  assert.ok(!JSON.stringify(backup).includes(partner))
  assert.ok(!JSON.stringify(backup).includes(source.ownerUserId))
})

test("appearance/settings round-trip exactly; private artwork and wanted image URLs are rejected", async () => {
  const { defaultBinderDesign } = await import("@/lib/binder-design")
  const { getDefaultBinderSettings } = await import("@/lib/settings")
  const source = snapshot()
  const appearance = [{ collectionId: source.collections[0].id, settings: getDefaultBinderSettings(), design: defaultBinderDesign() }]
  const backup = createBinderBackupV2({ snapshot: source, completeness: "complete-owner", scope: "all-inventory", appearance })
  assert.deepEqual(backup.appearance, appearance)
  appearance[0].design.surfaces.cover.artwork = "upload:synthetic"
  assert.throws(() => createBinderBackupV2({ snapshot: source, completeness: "complete-owner", scope: "all-inventory", appearance }), /#390/)
  source.binders[0].slots[3].wantedCards[0].card_image = "https://private.invalid/image?token=secret"
  assert.throws(() => createBinderBackupV2({ snapshot: source, completeness: "complete-owner", scope: "all-inventory" }), /asset URL/)
})

test("dangling/duplicate slots, placements, over-capacity snapshots and per-slot wants fail before planning", () => {
  const backup = createBinderBackupV2({ snapshot: snapshot(), completeness: "complete-owner", scope: "all-inventory" })
  for (const alter of [
    (b: typeof backup) => { b.binders[0].slots[1].id = b.binders[0].slots[0].id },
    (b: typeof backup) => { b.placements[1].slotId = b.placements[0].slotId },
    (b: typeof backup) => { b.binders[0].slots[0].inventoryItemId = "missing" },
    (b: typeof backup) => { b.binders[0].slots[3].wantedCards = Array(101).fill(b.binders[0].slots[3].wantedCards[0]) },
    (b: typeof backup) => { b.binders[0].slots = Array(4097).fill(b.binders[0].slots[0]) },
    (b: typeof backup) => { Object.assign(b.items[0], { session: "secret" }) },
  ]) { const changed = structuredClone(backup); alter(changed); assert.throws(() => parseBinderBackupV2(JSON.stringify(changed))) }
})
