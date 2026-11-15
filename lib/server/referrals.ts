import { cookies } from 'next/headers';
import type { BillingAccess } from '@/lib/billing';
import { getBillingAccess } from '@/lib/server/billing';
import { createAdminClient } from '@/lib/supabase/admin';
import { INVITE_COOKIE, readInviteCookie, REFERRAL_ACTIVATION_ENTRIES } from '@/lib/referrals';

const MISSING = ['PGRST202', 'PGRST205', '42883', '42P01'];

/**
 * Runs on the owner's own billing read, which every signed-in app open makes. First, a signed invite click on this
 * device is attributed once (the database decides: new account, not self, not a partner, first touch). Then a pending
 * referral is rewarded once the owner has 10 saved entries on the server. Before migration 133 both are no-ops.
 */
export async function settleReferral(ownerId: string, access: BillingAccess): Promise<BillingAccess> {
  const store = await cookies();
  const click = readInviteCookie(process.env.SUPABASE_SERVICE_ROLE_KEY!, store.get(INVITE_COOKIE)?.value);
  const admin = createAdminClient();
  let pending = access.referralPending;
  if (store.has(INVITE_COOKIE)) {
    if (click) {
      const { data, error } = await admin.rpc('attribute_referral_v1', {
        invitee: ownerId,
        invite_code: click.code,
        clicked_at: click.clickedAt,
      });
      if (error && !MISSING.includes(error.code)) throw error;
      pending ||= data === 'attributed';
    }
    // Any definite answer (or a forged/expired cookie) ends this click; only a thrown error retries next open.
    store.delete({ name: INVITE_COOKIE, path: '/app' });
  }
  if (!pending || access.savedCardCount < REFERRAL_ACTIVATION_ENTRIES) return access;
  const { data, error } = await admin.rpc('claim_referral_reward_v1', { invitee: ownerId });
  if (error && !MISSING.includes(error.code)) throw error;
  return data === 'rewarded' ? getBillingAccess(ownerId, admin) : access;
}

export async function inviteSummary(ownerId: string) {
  const admin = createAdminClient();
  const { data: code, error } = await admin.rpc('referral_code_v1', { owner: ownerId });
  if (error) return MISSING.includes(error.code) ? null : Promise.reject(error);
  const [{ data: rows, error: listError }, identity] = await Promise.all([
    admin.from('referrals').select('rewarded_at').eq('inviter_user_id', ownerId).limit(1000),
    admin.from('account_identities').select('username').eq('user_id', ownerId).maybeSingle(),
  ]);
  if (listError) throw listError;
  return {
    // The username is the friendlier join code; the random code still works for links already shared.
    code: (identity.data?.username as string | undefined) ?? (code as string),
    rewarded: rows.filter((r) => r.rewarded_at).length,
    pending: rows.filter((r) => !r.rewarded_at).length,
  };
}
