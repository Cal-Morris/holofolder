'use client';

import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

interface Invites {
  url: string;
  rewarded: number;
  pending: number;
  cap: number;
  rewardDays: number;
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
  );
}
