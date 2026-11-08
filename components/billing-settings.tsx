'use client'
import { useBillingContext } from '@/hooks/use-billing'
import { Button } from '@/components/ui/button'
export function BillingSettings({ signedIn, onSignIn }: { signedIn:boolean;onSignIn:()=>void }) {
  const billing = useBillingContext()
  if (!billing) return null
  const { access,busy } = billing
  return <section aria-label="Holo Folder plan" className="space-y-3 rounded-2xl border border-border bg-card p-4">
    <h3 className="font-bold">{access?.source === 'perpetual' ? 'Lifetime access' : access?.tier === 'paid' ? 'Holo Folder Premium' : 'Unlock Holo Folder'}</h3>
    {access?.source === 'perpetual' ? <p className="text-sm text-muted-foreground">All features, forever. Your existing account is fully unlocked, with no subscription needed.</p> : <>
      <p className="text-sm text-muted-foreground">Unlimited cards, beautiful share links, partner mode and sold price comparisons.</p>
      {access?.tier === 'paid' ? <p className="text-sm">Paid access until {access.paidThrough ? new Date(access.paidThrough).toLocaleDateString('en-GB') : 'your next renewal'}.</p> : access ? <p className="text-sm">{access.savedCardCount} of {access.cardLimit} free entries saved across your binders, including wanted cards. {access.freeBinderLimit} free {access.freeBinderLimit === 1 ? 'binder' : 'binders'}.</p> : <p className="text-sm">Sign in to check your free allowance.</p>}
      {!signedIn ? <Button className="min-h-11 w-full" onClick={onSignIn}>Sign in to upgrade</Button> : !billing.canManage ? <p className="text-sm">Your collection owner manages this plan.</p> : access?.tier === 'paid' ? <Button className="min-h-11 w-full" disabled={busy} onClick={()=>void billing.portal()}>Manage billing</Button> : <div className="space-y-2">
        <Button className="min-h-11 w-full" disabled={busy || billing.loading} onClick={()=>void billing.checkout('month')}>£2.99 / month</Button>
        <Button className="min-h-11 w-full" variant="outline" disabled={busy || billing.loading} onClick={()=>void billing.checkout('year')}>£29.99 / year, save £5.89</Button>
        <Button className="min-h-9 w-full" variant="ghost" disabled={busy || billing.loading} onClick={()=>void billing.portal()}>Manage existing billing</Button>
      </div>}
    </>}
    {billing.hasBillingAccount && (access?.source === "perpetual" || !billing.canManage) ? <Button className="min-h-11 w-full" disabled={busy} onClick={()=>void billing.portal()}>Manage my existing billing</Button> : null}
    {billing.loading && signedIn ? <p role="status" className="text-sm">Checking your plan…</p> : null}
    {billing.error ? <p role="status" className="text-sm text-muted-foreground">{billing.error}</p> : null}
  </section>
}
