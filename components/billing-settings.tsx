'use client';
import { useBillingContext } from '@/hooks/use-billing';
import { Button } from '@/components/ui/button';
import { OptionRow } from '@/components/ui/option-row';
import { LAUNCH_OFFER, launchOfferActive, launchOfferCoupon, planChoice, type BillingPlan } from '@/lib/billing';
import { useEffect, useState } from 'react';
import { useTrackCollectorEvent } from '@/components/collector-funnel';
import { cn } from '@/lib/utils';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

export function BillingSettings({
  signedIn,
  onSignIn,
  now,
  className,
}: {
  signedIn: boolean;
  onSignIn: () => void;
  now?: number;
  className?: string;
}) {
  const billing = useBillingContext();
  const [withCode, setWithCode] = useState(false);
  const [plan, setPlan] = useState<BillingPlan>('month');
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
  const blocked = busy || billing.loading;
  const choice = (option: BillingPlan) => planChoice(option, Boolean(launchOfferCoupon(option, withCode, at)));
  const plans: BillingPlan[] =
    access?.source === 'subscription'
      ? ['lifetime']
      : ['month', 'year', ...(billing.lifetimeAvailable ? (['lifetime'] as const) : [])];
  const selected = plans.includes(plan) ? plan : plans[0];
  const picker = (
    <div className="space-y-2">
      {offer ? (
        <p className="text-sm font-semibold">
          Launch offer: 50% off, ends {LAUNCH_OFFER.endLabel}
          {withCode ? (
            <span className="text-muted-foreground block text-xs font-normal">
              Enter your code at checkout. A code replaces the launch offer on monthly and lifetime; annual keeps it.
            </span>
          ) : null}
        </p>
      ) : null}
      {plans.map((option) => (
        <OptionRow
          key={option}
          {...choice(option)}
          selected={selected === option}
          disabled={blocked}
          onClick={() => setPlan(option)}
        />
      ))}
      <Button className="min-h-11 w-full" disabled={blocked} onClick={() => void billing.checkout(selected, withCode)}>
        {selected === 'lifetime' && access?.source === 'subscription' ? 'Buy lifetime' : 'Upgrade to Premium'}
      </Button>
      <div className="flex flex-wrap justify-center gap-x-1">
        {offer ? (
          <Button variant="ghost" className="min-h-9 text-xs" disabled={blocked} onClick={() => setWithCode(!withCode)}>
            {withCode ? 'Use the launch offer instead' : 'Have a creator code?'}
          </Button>
        ) : null}
        {access?.source !== 'subscription' ? (
          <Button variant="ghost" className="min-h-9 text-xs" disabled={blocked} onClick={() => void billing.portal()}>
            Manage existing billing
          </Button>
        ) : null}
      </div>
    </div>
  );
  return (
    <section
      aria-label="Holo Folder plan"
      className={cn('border-border bg-card space-y-3 rounded-2xl border p-4', className)}
    >
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
            Unlimited cards, multiple binders, custom layouts, partner mode and sold price comparisons, for you and your
            partner. Read-only sharing is free.
          </p>
          {access?.source === 'trial' ? (
            <p className="text-sm">
              Trial ends {day(access.trialEndsAt!)}
              {access.grantedUntil ? `, then your invite rewards keep Premium until ${day(access.grantedUntil)}` : ''}.
              No payment details needed, you won&apos;t be charged automatically. Afterwards you&apos;re back on free
              and keep everything you saved.
            </p>
          ) : access?.source === 'grant' ? (
            <p className="text-sm">
              Free Premium from invites until {day(access.grantedUntil!)}. No payment details needed, you won&apos;t be
              charged. Afterwards you&apos;re back on free and keep everything you saved.
            </p>
          ) : access?.tier === 'paid' ? (
            <p className="text-sm">
              Paid access until {access.paidThrough ? day(access.paidThrough) : 'your next renewal'}.
            </p>
          ) : access ? (
            <p className="text-sm">
              {access.cardLimit === null
                ? 'Unlimited cards and wanted cards.'
                : `${access.savedCardCount} of ${access.cardLimit} free entries saved across your binders, including wanted cards.`}{' '}
              {Number.isFinite(access.freeBinderLimit) &&
                `${access.freeBinderLimit} free ${access.freeBinderLimit === 1 ? 'binder' : 'binders'}.`}
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
              {billing.lifetimeAvailable ? (
                <>
                  {picker}
                  <p className="text-muted-foreground text-xs">
                    Buying lifetime doesn&apos;t cancel your subscription. Cancel it in Manage billing afterwards.
                  </p>
                </>
              ) : null}
            </div>
          ) : (
            picker
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
