import { getOfflineStore } from '@/lib/offline-store/kv'

const ACCOUNT_KEY = 'push:account'
export async function clearPushDevice() {
  // Clear the worker's account binding before any network request, including when offline.
  await getOfflineStore()?.delete(ACCOUNT_KEY)
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  for (const notification of await registration?.getNotifications?.() ?? []) notification.close()
  const subscription = await registration?.pushManager?.getSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe().catch(() => false)
  await fetch('/api/push/subscriptions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }), signal: AbortSignal.timeout(5000) }).catch(() => undefined)
}

export async function reconcilePushAccount(userId: string | null) {
  const store = getOfflineStore()
  const binding = await store?.get<{ userId: string }>(ACCOUNT_KEY)
  if (binding && binding.userId !== userId) await clearPushDevice()
}

export async function bindPushAccount(userId: string) {
  const store = getOfflineStore()
  if (!store) throw new Error('Device storage is unavailable. Enable browser storage to receive notifications.')
  await store.set(ACCOUNT_KEY, { userId })
}
