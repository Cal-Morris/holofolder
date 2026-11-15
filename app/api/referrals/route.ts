import { billingHeaders, billingUser } from '@/lib/server/billing-request';
import { inviteSummary } from '@/lib/server/referrals';
import { earningsSummary } from '@/lib/server/commissions';
import { inviteUrl, REFERRAL_INVITER_CAP, REFERRAL_REWARD_DAYS } from '@/lib/referrals';

/** The signed-in account's own invite link, how many invites have been rewarded and, for affiliates, earnings. */
export async function GET(request: Request) {
  try {
    const user = await billingUser(request);
    if (!user) return Response.json({ error: 'Sign in to invite friends.' }, { status: 401, headers: billingHeaders });
    const [summary, earnings] = await Promise.all([
      inviteSummary(user.id),
      // Only enrolled affiliates get earnings; a failure here never hides the invite link.
      earningsSummary(user.id).catch(() => null),
    ]);
    if (!summary)
      return Response.json({ error: 'Invites are not available yet.' }, { status: 503, headers: billingHeaders });
    return Response.json(
      {
        url: inviteUrl(summary.code),
        rewarded: summary.rewarded,
        pending: summary.pending,
        cap: REFERRAL_INVITER_CAP,
        rewardDays: REFERRAL_REWARD_DAYS,
        earnings,
      },
      { headers: billingHeaders },
    );
  } catch {
    return Response.json(
      { error: 'Invites are unavailable. Try again shortly.' },
      { status: 503, headers: billingHeaders },
    );
  }
}
