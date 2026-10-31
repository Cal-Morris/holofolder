import test from "node:test"
import assert from "node:assert/strict"
import { offlineChipLabel, syncingChipLabel } from "../lib/connection-chip"

test("offline chip copy with and without queued edits", () => {
  assert.equal(offlineChipLabel(0), "Offline · using saved cards and prices")
  assert.equal(offlineChipLabel(1), "Offline · 1 change to sync")
  assert.equal(offlineChipLabel(3), "Offline · 3 changes to sync")
})

test("online chip copy while queued edits sync", () => {
  assert.equal(syncingChipLabel(1), "1 change syncing")
  assert.equal(syncingChipLabel(2, "syncing"), "2 changes syncing")
  assert.equal(syncingChipLabel(1, "waiting"), "1 change syncing · retrying")
})
