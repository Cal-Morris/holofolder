import { deleteBrowserOfflineDatabase } from "@/lib/offline-store/kv"

export const STARTUP_RESET_KEY = "holofolder-startup-reset-v1"

export function isOfflineCacheKey(key: string) {
  return /^(?:pokemon_collection_(?:snapshot|pending_ops)_v1(?:[:]|$)|pokemon_collected$|pokemon_binder_settings(?:[:]|$)|holofolder_activity_(?:scope|cache)_v1$|binderdex_(?:start_v1|device_binders_v1|card_price_cache_v\d+)$|holofolder-navigation-v1:|holofolder_billing_v1$)/.test(key)
}

/** One tab gets one automatic reset. Never touches cookies, auth storage or the device identity. */
export async function resetStartupCaches() {
  for (const key of Object.keys(localStorage)) if (isOfflineCacheKey(key)) localStorage.removeItem(key)
  const results = await Promise.allSettled([
    deleteBrowserOfflineDatabase(),
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("binderdex-")).map(key => caches.delete(key)))),
    navigator.serviceWorker?.getRegistrations().then(registrations => Promise.all(registrations
      .filter(registration => new URL(registration.active?.scriptURL ?? registration.installing?.scriptURL ?? location.href).pathname === "/app/sw.js")
      .map(registration => registration.unregister()))),
  ])
  const failed = results.find(result => result.status === "rejected")
  if (failed?.status === "rejected") throw failed.reason
}
