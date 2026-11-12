import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdsQueuedEdits, isOfflineCacheKey, isAppServiceWorker } from '../lib/startup-cache-reset';

test('startup reset selects offline caches, never auth credentials or device identity', () => {
  for (const key of [
    'pokemon_collection_snapshot_v1',
    'pokemon_collection_snapshot_v1:synthetic-binder',
    'pokemon_collection_pending_ops_v1',
    'pokemon_collected',
    'pokemon_binder_settings:synthetic-owner',
    'holofolder_activity_cache_v1',
    'binderdex_start_v1',
    'binderdex_device_binders_v1',
    'binderdex_card_price_cache_v7',
    'holofolder-navigation-v1:synthetic',
    'holofolder_billing_v1',
  ])
    assert.equal(isOfflineCacheKey(key), true, key);
  for (const key of [
    'sb-synthetic-auth-token',
    'holofolder-slot-device-v1',
    'unrelated',
    'binderdex_settings',
    'holofolder-startup-reset-v2',
  ])
    assert.equal(isOfflineCacheKey(key), false, key);
});

test('startup reset keeps queued edits and the binder they replay against', () => {
  assert.equal(holdsQueuedEdits('slot-intent:v1:["synthetic-device"]'), true);
  assert.equal(holdsQueuedEdits('slot-navigation-v1:["synthetic-device"]'), true);
  assert.equal(holdsQueuedEdits('tcg-set:synthetic'), false);
});

test('startup reset recognizes the real query-route worker and legacy script, preserving unrelated workers', () => {
  const origin = 'https://holofolder.com';
  for (const script of ['/app?service-worker=1', '/app/sw.js'])
    assert.equal(isAppServiceWorker(origin + script, origin + '/app', origin), true, script);
  for (const script of ['/app', '/app?service-worker=0', '/app?other=1', '/other/sw.js', '/sw.js'])
    assert.equal(isAppServiceWorker(origin + script, origin + '/app', origin), false, script);
  assert.equal(isAppServiceWorker(origin + '/app/sw.js', origin + '/unrelated/', origin), false);
  assert.equal(isAppServiceWorker('https://other.example/app?service-worker=1', origin + '/app', origin), false);
});
