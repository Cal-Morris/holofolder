'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { resolveBillingAccess, type BillingAccess } from '@/lib/billing'
import { BILLING_CHANGED, readBillingCache, writeBillingCache } from '@/lib/billing-cache'

export function useBilling(accountId: string | null, ownerId: string | null, onUpgrade: () => void) {
  const [record,setRecord] = useState<{ accountId: string; access: BillingAccess; canManage: boolean; hasBillingAccount?: boolean } | null>(null)
  const [error,setError] = useState<string | null>(null)
  const [busy,setBusy] = useState(false)
  const refresh = useCallback(async (reconcile = false) => {
    if (!accountId || !ownerId) return
    if (!navigator.onLine) {
      const saved = readBillingCache(localStorage,accountId,ownerId)
      if (saved) setRecord({ accountId, access: saved, canManage: accountId === ownerId })
      return
    }
    try {
      const response = await fetch('/app/api/billing',{ method: reconcile ? 'POST' : 'GET', cache:'no-store', signal:AbortSignal.timeout(15000) })
      const result = await response.json()
      if (!response.ok || result.access?.ownerUserId !== ownerId) throw new Error(result.error ?? 'Your plan could not be checked.')
      const row = result.access
      const access = resolveBillingAccess(ownerId,{ enforced:row.enforced,perpetual:row.source === 'perpetual',status:row.source === 'subscription' ? 'active' : 'none',paid_through:row.paidThrough,trial_ends_at:row.trialEndsAt,saved_card_count:row.savedCardCount,free_card_limit:row.freeCardLimit,free_binder_limit:row.freeBinderLimit })
      writeBillingCache(localStorage,accountId,access)
      setRecord({ accountId,access,canManage:result.canManage === true,hasBillingAccount:result.hasBillingAccount === true })
      setError(null)
      window.dispatchEvent(new Event(BILLING_CHANGED))
    } catch(failure) {
      setError(failure instanceof Error ? failure.message : 'Your plan could not be checked.')
      const saved = readBillingCache(localStorage,accountId,ownerId)
      if (saved) setRecord({ accountId,access:saved,canManage:accountId === ownerId })
    }
  },[accountId,ownerId])
  useEffect(() => {
    queueMicrotask(() => { void refresh(new URLSearchParams(location.search).has('billing')) })
    const online = () => { void refresh() }
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('holofolder-refresh-billing',online); window.addEventListener('online',online); document.addEventListener('visibilitychange',visible)
    const timer = window.setInterval(visible,60000)
    return () => { window.removeEventListener('holofolder-refresh-billing',online); window.removeEventListener('online',online);document.removeEventListener('visibilitychange',visible);window.clearInterval(timer) }
  },[refresh])
  const navigate = async (path: string, body?: object) => {
    if (!accountId) { onUpgrade(); return }
    if (!navigator.onLine) { setError('Connect to the internet to manage your plan.'); return }
    setBusy(true);setError(null)
    try {
      const response = await fetch(`/app/api/billing/${path}`,{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body ?? {}),signal:AbortSignal.timeout(45000) })
      const result = await response.json()
      if (!response.ok || typeof result.url !== 'string') throw new Error(result.error ?? 'Billing could not be opened.')
      const url = new URL(result.url)
      if (url.protocol !== 'https:' || !['checkout.stripe.com','billing.stripe.com'].includes(url.hostname)) throw new Error('Unexpected billing address.')
      location.assign(url.href)
    } catch(failure) { setError(failure instanceof Error ? failure.message : 'Billing could not be opened.') }
    finally { setBusy(false) }
  }
  const active = record?.accountId === accountId && record.access.ownerUserId === ownerId ? record : null
  const access = active ? resolveBillingAccess(active.access.ownerUserId,{perpetual:active.access.source==='perpetual',status:active.access.source==='subscription'?'active':'none',paid_through:active.access.paidThrough,trial_ends_at:active.access.trialEndsAt,enforced:active.access.enforced,saved_card_count:active.access.savedCardCount,free_card_limit:active.access.freeCardLimit,free_binder_limit:active.access.freeBinderLimit}) : null
  return { access, hasBillingAccount: active?.hasBillingAccount ?? false, canManage: active?.canManage ?? accountId === ownerId, loading: Boolean(accountId && !active), error, busy,
    premium: access ? !access.enforced || access.tier === 'paid' : false,
    refresh, upgrade:onUpgrade, checkout:(interval:'month'|'year')=>navigate('checkout',{interval}), portal:()=>navigate('portal') }
}
export type BillingState = ReturnType<typeof useBilling>
export const BillingContext = createContext<BillingState | null>(null)
export function useBillingContext() { return useContext(BillingContext) }
