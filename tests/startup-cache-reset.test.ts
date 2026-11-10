import { test } from "node:test"
import assert from "node:assert/strict"
import { isOfflineCacheKey } from "../lib/startup-cache-reset"

test("startup reset selects offline caches, never auth credentials or device identity", () => {
  for (const key of ["pokemon_collection_snapshot_v1", "pokemon_collection_snapshot_v1:synthetic-binder", "pokemon_collection_pending_ops_v1", "pokemon_collected", "pokemon_binder_settings:synthetic-owner", "holofolder_activity_cache_v1", "binderdex_start_v1", "binderdex_device_binders_v1", "binderdex_card_price_cache_v7", "holofolder-navigation-v1:synthetic", "holofolder_billing_v1"]) assert.equal(isOfflineCacheKey(key), true, key)
  for (const key of ["sb-synthetic-auth-token", "holofolder-slot-device-v1", "unrelated", "binderdex_settings", "holofolder-startup-reset-v1"]) assert.equal(isOfflineCacheKey(key), false, key)
})
