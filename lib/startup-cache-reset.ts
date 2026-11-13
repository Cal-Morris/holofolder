import { SERVICE_WORKER_URL } from '@/lib/service-worker-registration';
import { getOfflineStore } from '@/lib/offline-store/kv';

// Leave room for the 30s browser inventory request and 15s server read budget.
export const CHECKED_STARTUP_TIMEOUT_MS = 45_000;
export const CHECKED_STARTUP_TIMEOUT_ERROR = `Account and storage startup timed out after ${CHECKED_STARTUP_TIMEOUT_MS / 1000} seconds`;

export const STARTUP_RESET_KEY = 'holofolder-startup-reset-v2';

export function isOfflineCacheKey(key: string) {
  return /^(?:pokemon_collection_(?:snapshot|pending_ops)_v1(?:[:]|$)|pokemon_collected$|pokemon_binder_settings(?:[:]|$)|holofolder_activity_(?:scope|cache)_v1$|binderdex_(?:start_v1|device_binders_v1|card_price_cache_v\d+)$|holofolder-navigation-v1:|holofolder_billing_v1$)/.test(
    key,
  );
}

/** Queued edits and the saved binder they replay against. A reset must never drop these. */
export function holdsQueuedEdits(key: string) {
  return key.startsWith('slot-intent:') || key.startsWith('slot-navigation-v1:');
}

async function clearOfflineRecords() {
  const store = getOfflineStore();
  if (!store) return;
  const keys = (await store.keys()).filter((key) => !holdsQueuedEdits(key));
  await Promise.all(keys.map((key) => store.delete(key)));
}

export function isAppServiceWorker(scriptURL: string, scope: string, origin: string) {
  const script = new URL(scriptURL);
  const registeredScope = new URL(scope);
  return (
    script.origin === origin &&
    registeredScope.origin === origin &&
    ['/app', '/app/'].includes(registeredScope.pathname) &&
    (script.pathname === '/app/sw.js' || script.href === new URL(SERVICE_WORKER_URL, origin).href)
  );
}

/** One tab gets one automatic reset. Never touches cookies, auth storage, the device identity or queued edits. */
export async function resetStartupCaches() {
  for (const key of Object.keys(localStorage)) if (isOfflineCacheKey(key)) localStorage.removeItem(key);
  const results = await Promise.allSettled([
    clearOfflineRecords(),
    caches
      .keys()
      .then((keys) => Promise.all(keys.flatMap((key) => (key.startsWith('binderdex-') ? [caches.delete(key)] : [])))),
    navigator.serviceWorker
      ?.getRegistrations()
      .then((registrations) =>
        Promise.all(
          registrations.flatMap((registration) =>
            isAppServiceWorker(
              registration.active?.scriptURL ??
                registration.waiting?.scriptURL ??
                registration.installing?.scriptURL ??
                location.href,
              registration.scope,
              location.origin,
            )
              ? [registration.unregister()]
              : [],
          ),
        ),
      ),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
