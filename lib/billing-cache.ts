import { resolveBillingAccess, type BillingAccess } from '@/lib/billing'
export const BILLING_CACHE_KEY = 'holofolder_billing_v1'
export const BILLING_CHANGED = 'holofolder-billing-changed'
export function readBillingCache(storage: Pick<Storage,'getItem'>, accountId: string | null, ownerId: string | null, now = Date.now()): BillingAccess | null {
  if (!accountId || !ownerId) return null
  try {
    const record = JSON.parse(storage.getItem(BILLING_CACHE_KEY) ?? 'null')
    if (record?.accountId !== accountId || record?.access?.ownerUserId !== ownerId) return null
    const access = record.access
    return resolveBillingAccess(ownerId,{ perpetual: access.source === 'perpetual', status: access.source === 'subscription' ? 'active' : 'none', paid_through: access.paidThrough, trial_ends_at: access.trialEndsAt, saved_card_count: access.savedCardCount, enforced: access.enforced, free_card_limit: access.freeCardLimit, free_binder_limit: access.freeBinderLimit },now)
  } catch { return null }
}
export function writeBillingCache(storage: Pick<Storage,'setItem'>, accountId: string, access: BillingAccess) {
  try { storage.setItem(BILLING_CACHE_KEY,JSON.stringify({ accountId, access })) } catch { /* Offline access remains conservative when storage is unavailable. */ }
}
