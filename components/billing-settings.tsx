'use client'
import { useBillingContext } from '@/hooks/use-billing'
import { Button } from '@/components/ui/button'
import { BILLING_PRICES, BILLING_ANNUAL_SAVING, billingAmount } from '@/lib/billing'
import { useEffect } from 'react'
import { useTrackCollectorEvent } from '@/components/collector-funnel'
export function BillingSettings({ signedIn, onSignIn }: { signedIn:boolean;onSignIn:()=>void }) {
  const billing = useBillingContext()
  const track = useTrackCollectorEvent()
  const accountId = signedIn && billing?.canManage && billing.access?.tier === 'free' ? billing.access.ownerUserId : null
  useEffect(() => { if (accountId) void track('upgrade_viewed', accountId) }, [accountId,track])
  if (!billing) return null
  const { access,busy } = billing
  return <section aria-label="Holo Folder plan" className="space-y-3 rounded-2xl border border-border bg-card p-4">
    <h3 className="font-bold">{access?.source === 'perpetual' ? 'Lifetime access' : access?.source === 'trial' ? '7-day Premium trial' : access?.tier === 'paid' ? 'Holo Folder Premium' : 'Unlock Holo Folder'}</h3>
    {access?.source === 'perpetual' ? <p className="text-sm text-muted-foreground">All features, forever. Your existing account is fully unlocked, with no subscription needed.</p> : <>
      <p className="text-sm text-muted-foreground">Unlimited cards, multiple binders, partner mode and sold price comparisons. Read-only sharing is free.</p>
      <p className="text-sm text-muted-foreground">One subscription for the collection owner, including their partner.</p>
      {access?.source === 'trial' ? <p className="text-sm">Trial ends {new Date(access.trialEndsAt!).toLocaleString('en-GB')}. No payment details needed, you won&apos;t be charged automatically. After the trial, you return to free and keep your saved cards and binders.</p> : access?.tier === 'paid' ? <p className="text-sm">Paid access until {access.paidThrough ? new Date(access.paidThrough).toLocaleDateString('en-GB') : 'your next renewal'}.</p> : access ? <p className="text-sm">{access.savedCardCount} of {access.cardLimit} free entries saved across your binders, including wanted cards. {access.freeBinderLimit} free {access.freeBinderLimit === 1 ? 'binder' : 'binders'}.</p> : <p className="text-sm">Sign in to check your free allowance.</p>}
      {!signedIn ? <Button className="min-h-11 w-full" onClick={onSignIn}>Sign in to upgrade</Button> : !billing.canManage ? <p className="text-sm">Your collection owner manages this plan.</p> : access?.source === 'subscription' ? <Button className="min-h-11 w-full" disabled={busy} onClick={()=>void billing.portal()}>Manage billing</Button> : <div className="space-y-2">
        <Button className="min-h-11 w-full" disabled={busy || billing.loading} onClick={()=>void billing.checkout('month')}>{billingAmount(BILLING_PRICES.month)} / month</Button>
        <Button className="min-h-11 w-full" variant="outline" disabled={busy || billing.loading} onClick={()=>void billing.checkout('year')}>{billingAmount(BILLING_PRICES.year)} / year, save {billingAmount(BILLING_ANNUAL_SAVING)}</Button>
        <Button className="min-h-9 w-full" variant="ghost" disabled={busy || billing.loading} onClick={()=>void billing.portal()}>Manage existing billing</Button>
      </div>}
    </>}
    {billing.hasBillingAccount && (access?.source === "perpetual" || !billing.canManage) ? <Button className="min-h-11 w-full" disabled={busy} onClick={()=>void billing.portal()}>Manage my existing billing</Button> : null}
    {billing.loading && signedIn ? <p role="status" className="text-sm">Checking your plan…</p> : null}
    {billing.error ? <p role="status" className="text-sm text-muted-foreground">{billing.error}</p> : null}
  </section>
}
