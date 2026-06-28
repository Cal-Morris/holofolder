import test from "node:test"
import assert from "node:assert/strict"
import { getSettingsLocalCollectedCount } from "../lib/settings-collection-sync"

test("getSettingsLocalCollectedCount hides stale local mirror counts once signed in and synced", () => {
  assert.equal(getSettingsLocalCollectedCount({
    isSignedIn: true,
    cloudCollectedCount: 568,
    localCollectedCount: 567,
    localPendingSyncCount: 0,
  }), 568)
})

test("getSettingsLocalCollectedCount keeps the local count when local work is pending or signed out", () => {
  assert.equal(getSettingsLocalCollectedCount({
    isSignedIn: true,
    cloudCollectedCount: 568,
    localCollectedCount: 569,
    localPendingSyncCount: 1,
  }), 569)

  assert.equal(getSettingsLocalCollectedCount({
    isSignedIn: false,
    cloudCollectedCount: 0,
    localCollectedCount: 42,
    localPendingSyncCount: 0,
  }), 42)
})
