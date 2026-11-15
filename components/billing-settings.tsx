'use client';
import { useBillingContext } from '@/hooks/use-billing';
import { Button } from '@/components/ui/button';
import {
  BILLING_PRICES,
  BILLING_ANNUAL_SAVING,
  BILLING_LIFETIME_PRICE,
  LAUNCH_OFFER,
  billingAmount,
  launchOfferActive,
  launchOfferCoupon,
  launchOfferText,
  type BillingPlan,
} from '@/lib/billing';
import { useEffect, useState } from 'react';
import { useTrackCollectorEvent } from '@/components/collector-funnel';
export function BillingSettings({
  signedIn,
  onSignIn,
  now,
}: {
  signedIn: boolean;
  onSignIn: () => void;
  now?: number;
}) {
  const billing = useBillingContext();
  const [withCode, setWithCode] = useState(false);
  // Read once per mount; the server decides the real discount at checkout anyway.
  const [mountedAt] = useState(() => Date.now());
  const track = useTrackCollectorEvent();
  const accountId =
    // oxlint-disable-next-line react-doctor/no-event-handler -- records that a free account viewed the plan, once it is known
    signedIn && billing?.canManage && billing.access?.tier === 'free' ? billing.access.ownerUserId : null;
  useEffect(() => {
    if (accountId) void track('upgrade_viewed', accountId);
  }, [accountId, track]);
  if (!billing) return null;
  const { access, busy } = billing;
  const at = now ?? mountedAt;
  const offer = launchOfferActive(at);
  // The offer's own wording, minus the "Launch offer:" prefix the notice above the buttons already carries.
  const label = (plan: BillingPlan, normal: string) =>
    launchOfferCoupon(plan, withCode, at) ? launchOfferText(plan).replace('Launch offer: ', '') : normal;
  const offerButton = 'h-auto min-h-11 w-full py-2 whitespace-normal';
  const lifetimeButton = billing.lifetimeAvailable ? (
    <Button
      className={offerButton}
      variant="outline"
      disabled={busy || billing.loading}
      onClick={() => void billing.checkout('lifetime', withCode)}
    >
      {label('lifetime', `${billingAmount(BILLING_LIFETIME_PRICE)} once, lifetime access`)}
    </Button>
  ) : null;
  const offerNotice = offer ? (
    <div className="space-y-1">
      <p className="text-sm font-semibold">Launch offer: 50% off, ends {LAUNCH_OFFER.endLabel}</p>
      {withCode ? (
        <p className="text-muted-foreground text-sm">
          Enter your code at checkout. A code replaces the launch offer on monthly and lifetime; annual keeps the launch
          offer.
        </p>
      ) : null}
    </div>
  ) : null;
  const codeToggle = offer ? (
    <Button
      className="min-h-9 w-full"
      variant="ghost"
      disabled={busy || billing.loading}
      onClick={() => setWithCode(!withCode)}
    >
      {withCode ? 'Use the launch offer instead' : 'Have a creator code?'}
    </Button>
  ) : null;
  return (
    <section aria-label="Holo Folder plan" className="border-border bg-card space-y-3 rounded-2xl border p-4">
      <h3 className="font-bold">
        {access?.source === 'perpetual'
          ? 'Lifetime access'
          : access?.source === 'trial'
            ? '7-day Premium trial'
            : access?.tier === 'paid'
              ? 'Holo Folder Premium'
              : 'Unlock Holo Folder'}
      </h3>
      {access?.source === 'perpetual' ? (
        <>
          <p className="text-muted-foreground text-sm">
            All features, forever. Your existing account is fully unlocked, with no subscription needed.
          </p>
          {billing.subscriptionActive && billing.canManage ? (
            <p className="text-sm">
              Your subscription is still active. Cancel it in Manage billing so you aren&apos;t charged again.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Unlimited cards, multiple binders, custom layouts, partner mode and sold price comparisons. Read-only
            sharing is free.
          </p>
          <p className="text-muted-foreground text-sm">
            One subscription for the collection owner, including their partner.
          </p>
          {access?.source === 'trial' ? (
            <p className="text-sm">
              Trial ends {new Date(access.trialEndsAt!).toLocaleString('en-GB')}. No payment details needed, you
              won&apos;t be charged automatically. After the trial, you return to free and keep your saved cards and
              binders.
              {access.grantedUntil
                ? ` Your invite rewards then keep Premium until ${new Date(access.grantedUntil).toLocaleDateString('en-GB')}.`
                : null}
            </p>
          ) : access?.source === 'grant' ? (
            <p className="text-sm">
              Free Premium from invites until {new Date(access.grantedUntil!).toLocaleDateString('en-GB')}. No payment
              details needed, you won&apos;t be charged. Afterwards you return to free and keep your saved cards and
              binders.
            </p>
          ) : access?.tier === 'paid' ? (
            <p className="text-sm">
              Paid access until{' '}
              {access.paidThrough ? new Date(access.paidThrough).toLocaleDateString('en-GB') : 'your next renewal'}.
            </p>
          ) : access ? (
            <p className="text-sm">
              {access.cardLimit === null
                ? 'Unlimited cards and wanted cards.'
                : `${access.savedCardCount} of ${access.cardLimit} free entries saved across your binders, including wanted cards.`}{' '}
              {access.freeBinderLimit} free {access.freeBinderLimit === 1 ? 'binder' : 'binders'}.
            </p>
          ) : (
            <p className="text-sm">Sign in to check your free allowance.</p>
          )}
          {!signedIn ? (
            <Button className="min-h-11 w-full" onClick={onSignIn}>
              Sign in to upgrade
            </Button>
          ) : !billing.canManage ? (
            <p className="text-sm">Your collection owner manages this plan.</p>
          ) : access?.source === 'subscription' ? (
            <div className="space-y-2">
              <Button className="min-h-11 w-full" disabled={busy} onClick={() => void billing.portal()}>
                Manage billing
              </Button>
              {lifetimeButton ? offerNotice : null}
              {lifetimeButton}
              {lifetimeButton ? codeToggle : null}
              {lifetimeButton ? (
                <p className="text-muted-foreground text-sm">
                  Buying lifetime doesn&apos;t cancel your subscription. Cancel it in Manage billing afterwards.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              {offerNotice}
              <Button
                className={offerButton}
                disabled={busy || billing.loading}
                onClick={() => void billing.checkout('month', withCode)}
              >
                {label('month', `${billingAmount(BILLING_PRICES.month)} / month`)}
              </Button>
              <Button
                className={offerButton}
                variant="outline"
                disabled={busy || billing.loading}
                onClick={() => void billing.checkout('year', withCode)}
              >
                {label(
                  'year',
                  `${billingAmount(BILLING_PRICES.year)} / year, save ${billingAmount(BILLING_ANNUAL_SAVING)}`,
                )}
              </Button>
              {lifetimeButton}
              {codeToggle}
              <Button
                className="min-h-9 w-full"
                variant="ghost"
                disabled={busy || billing.loading}
                onClick={() => void billing.portal()}
              >
                Manage existing billing
              </Button>
            </div>
          )}
        </>
      )}
      {billing.hasBillingAccount && (access?.source === 'perpetual' || !billing.canManage) ? (
        <Button className="min-h-11 w-full" disabled={busy} onClick={() => void billing.portal()}>
          Manage my existing billing
        </Button>
      ) : null}
      {billing.loading && signedIn ? (
        <p role="status" className="text-sm">
          Checking your plan…
        </p>
      ) : null}
      {billing.error ? (
        <p role="status" className="text-muted-foreground text-sm">
          {billing.error}
        </p>
      ) : null}
    </section>
  );
}
