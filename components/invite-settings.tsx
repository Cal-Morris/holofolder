'use client';

import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { billingAmount } from '@/lib/billing';

interface Earnings {
  code: string | null;
  active: boolean;
  customers: number;
  pendingPence: number;
  payablePence: number;
  paidPence: number;
}

interface Invites {
  url: string;
  rewarded: number;
  pending: number;
  cap: number;
  rewardDays: number;
  /** Only for accounts enrolled in the commission programme (migration 140). */
  earnings?: Earnings | null;
}

/** Settings → Plan, for collection owners: their stable invite link. Rewards are granted by the server (migration 133). */
export function InviteSettings({ isOnline }: { isOnline: boolean }) {
  const [invites, setInvites] = useState<Invites | null>(null);
  const [error, setError] = useState<string | null>(null);
  // oxlint-disable-next-line react-doctor/no-effect-event-handler, react-doctor/no-fetch-in-effect -- loads the invite link when Plan opens online; aborted on change
  useEffect(() => {
    if (!isOnline) return;
    const controller = new AbortController();
    fetch('/app/api/referrals', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Invites are unavailable.');
        setInvites(body);
        setError(null);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Invites are unavailable.');
      });
    return () => controller.abort();
  }, [isOnline]);
  const copy = async () => {
    if (!invites) return;
    try {
      await navigator.clipboard.writeText(invites.url);
      toast('Invite link copied');
    } catch {
      toast('Could not copy the invite link', 'error');
    }
  };
  return (
    <>
      {invites?.earnings && <EarningsSettings earnings={invites.earnings} />}
      <section aria-label="Invite a friend" className="space-y-3">
        <h3 className="font-semibold">Invite a friend</h3>
        <p className="text-muted-foreground text-xs">
          When a friend makes a new account with your link and saves 10 cards, you both get a free month of Premium. No
          payment details, and it never turns into a charge.
        </p>
        {invites ? (
          <div className="border-border/50 bg-muted/25 space-y-3 rounded-2xl border p-3">
            <div className="border-border/50 bg-background/70 text-muted-foreground rounded-xl border px-3 py-2 text-xs break-all">
              {invites.url}
            </div>
            <Button type="button" variant="outline" className="w-full gap-2" onClick={() => void copy()}>
              <Copy className="h-4 w-4" />
              Copy invite link
            </Button>
            <p role="status" className="text-muted-foreground text-xs">
              {invites.rewarded} of {invites.cap} free months earned
              {invites.pending
                ? `, ${invites.pending} ${invites.pending === 1 ? 'friend' : 'friends'} yet to save 10 cards`
                : ''}
              .
            </p>
          </div>
        ) : (
          <p role="status" className="text-muted-foreground text-xs">
            {!isOnline ? 'Connect to the internet to see your invite link.' : (error ?? 'Loading your invite link…')}
          </p>
        )}
      </section>
      {invites && !invites.earnings && <AffiliateInvite />}
    </>
  );
}

/** Points people with an audience at the commission programme. Cal enrols affiliates by hand (docs/billing.md). */
function AffiliateInvite() {
  return (
    <section aria-label="Affiliate programme" className="space-y-3">
      <h3 className="font-semibold">Affiliate programme</h3>
      <p className="text-muted-foreground text-xs">
        Make Pokémon card content or run a community? Affiliates earn 30% of what the people they bring in pay in their
        first year, and 30% of lifetime purchases, paid out monthly.
      </p>
      <Button asChild variant="outline" className="w-full">
        <a href="mailto:contact@holofolder.com?subject=Holo%20Folder%20affiliate%20programme">
          Apply to be an affiliate
        </a>
      </Button>
    </section>
  );
}

/** Commission programme: the affiliate's code and totals. Customers are only counted, never named. */
function EarningsSettings({ earnings }: { earnings: Earnings }) {
  const rows = [
    ['Customers you brought in', String(earnings.customers)],
    ['Pending (30-day hold)', billingAmount(earnings.pendingPence)],
    ['Ready to pay out', billingAmount(earnings.payablePence)],
    ['Paid to you', billingAmount(earnings.paidPence)],
  ];
  return (
    <section aria-label="Earnings" className="space-y-3">
      <h3 className="font-semibold">Earnings</h3>
      <p className="text-muted-foreground text-xs">
        You earn 30% of what customers pay in their first 12 months when they use your
        {earnings.code ? ` code ${earnings.code} or` : ''} invite link, and 30% of a lifetime purchase. Earnings are
        held for 30 days in case of refunds, then paid out monthly.
        {earnings.active ? '' : ' Your enrolment is paused, so new payments are not earning.'}
      </p>
      <dl className="border-border/50 bg-muted/25 divide-border/50 divide-y rounded-2xl border px-3 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
