// Operator only: the commission programme (migration 140). Read-only report unless a write flag and --apply are given.
// No money moves here; Cal pays out by hand and then marks those entries paid.
//   bun run commissions --month=2026-12                       payable per affiliate, ready for that month's payout
//   bun run commissions --mark-paid=<id>,<id> --apply         after paying, mark exactly those entries paid
//   bun run commissions --enrol --owner=<uuid> --name="Ash" --payout-email=ash@example.com --promo=promo_123 --apply
//   bun run commissions --pause --owner=<uuid> --apply         no new customers or earnings; the ledger stays
import { parseArgs } from 'node:util';
import Stripe from 'stripe';
import { createAdminClient } from '../lib/supabase/admin';
import { fetchAllRows } from '../lib/supabase/fetch-all-rows';
import { billingAmount } from '../lib/billing';
import { summariseEarnings } from '../lib/commissions';

const HOLO_ACCOUNT = 'acct_1AHHDjGnHtZtNtvx';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const { values } = parseArgs({
    options: {
      month: { type: 'string' },
      'mark-paid': { type: 'string' },
      enrol: { type: 'boolean' },
      pause: { type: 'boolean' },
      owner: { type: 'string' },
      name: { type: 'string' },
      'payout-email': { type: 'string' },
      promo: { type: 'string' },
      apply: { type: 'boolean' },
    },
  });
  const admin = createAdminClient();
  const apply = values.apply === true;
  const dry = apply ? '' : ' (dry run, add --apply)';

  if (values.enrol || values.pause) {
    const owner = values.owner ?? '';
    if (!UUID.test(owner)) throw new Error('Pass --owner=<auth user uuid>.');
    const { data: user, error } = await admin.auth.admin.getUserById(owner);
    if (error || !user.user) throw new Error('No account with that id.');
    if (values.pause) {
      if (apply) {
        const { error: pauseError } = await admin
          .from('affiliates')
          .update({ active: false })
          .eq('owner_user_id', owner);
        if (pauseError) throw pauseError;
      }
      console.log(`Paused affiliate ${owner}${dry}`);
      return;
    }
    const name = values.name?.trim(),
      payoutEmail = values['payout-email']?.trim();
    if (!name || !payoutEmail?.includes('@')) throw new Error('Pass --name and --payout-email.');
    let promotionCode: string | null = null;
    if (values.promo) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '');
      if ((await stripe.accounts.retrieve(null)).id !== HOLO_ACCOUNT)
        throw new Error('STRIPE_SECRET_KEY is not for the Holo Folder Stripe account; nothing changed');
      const promo = await stripe.promotionCodes.retrieve(values.promo);
      if (promo.metadata?.app !== 'holofolder') throw new Error('That promotion code is not a Holo Folder code.');
      promotionCode = promo.code;
    }
    const row = {
      owner_user_id: owner,
      display_name: name,
      payout_email: payoutEmail,
      stripe_promotion_code_id: values.promo ?? null,
      promotion_code: promotionCode,
      active: true,
    };
    if (apply) {
      const { error: enrolError } = await admin.from('affiliates').upsert(row, { onConflict: 'owner_user_id' });
      if (enrolError) throw enrolError;
    }
    console.log(
      `Enrolled ${name} (${owner})${promotionCode ? ` with code ${promotionCode}` : ', invite link only'}${dry}`,
    );
    return;
  }

  if (values['mark-paid']) {
    const ids = values['mark-paid'].split(',').map((id) => id.trim());
    if (!ids.length || ids.length > 500 || !ids.every((id) => UUID.test(id)))
      throw new Error('Pass --mark-paid=<entry id>,<entry id> (at most 500).');
    const now = new Date().toISOString();
    // Only entries that are still pending and past their hold; anything else is reported, never changed.
    const query = admin
      .from('commission_entries')
      .select('id')
      .in('id', ids)
      .eq('status', 'pending')
      .lte('hold_until', now);
    const { data, error } = apply
      ? await admin
          .from('commission_entries')
          .update({ status: 'paid', paid_out_at: now })
          .in('id', ids)
          .eq('status', 'pending')
          .lte('hold_until', now)
          .select('id')
      : await query;
    if (error) throw error;
    const marked = new Set(data.map((row) => row.id));
    console.log(`Marked paid: ${marked.size}${dry}`);
    const refused = ids.filter((id) => !marked.has(id));
    if (refused.length) console.log(`Not changed (unknown, already paid or still on hold): ${refused.join(', ')}`);
    return;
  }

  // Report: entries whose 30-day hold has ended by the end of the month (or now, if sooner) and are not paid yet,
  // including earlier months carried forward and refunds that take money back.
  const month = values.month ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Pass --month=YYYY-MM.');
  const [year, m] = month.split('-').map(Number);
  const cutoff = Math.min(Date.UTC(year, m, 1), Date.now());
  const [affiliates, entries] = await Promise.all([
    fetchAllRows<{ owner_user_id: string; display_name: string; payout_email: string; promotion_code: string | null }>(
      (from, to) =>
        admin
          .from('affiliates')
          .select('owner_user_id,display_name,payout_email,promotion_code')
          .order('owner_user_id')
          .range(from, to),
    ),
    fetchAllRows<{
      id: string;
      affiliate_owner_id: string;
      kind: string;
      commission_pence: number;
      status: string;
      hold_until: string;
    }>((from, to) =>
      admin
        .from('commission_entries')
        .select('id,affiliate_owner_id,kind,commission_pence,status,hold_until')
        .eq('status', 'pending')
        .order('id')
        .range(from, to),
    ),
  ]);
  if (affiliates.error || entries.error) throw new Error('Commission data could not be read.');
  console.log(`Commission payouts for ${month}, payable as of ${new Date(cutoff).toISOString()}`);
  for (const affiliate of affiliates.data) {
    const mine = entries.data.filter((e) => e.affiliate_owner_id === affiliate.owner_user_id);
    const payable = mine.filter((e) => new Date(e.hold_until).getTime() <= cutoff);
    const { payablePence, pendingPence } = summariseEarnings(mine, cutoff);
    if (!mine.length) continue;
    console.log(
      `\n${affiliate.display_name} <${affiliate.payout_email}> ${affiliate.promotion_code ?? '(invite link only)'}`,
    );
    console.log(`  payable ${billingAmount(payablePence)}, still on hold ${billingAmount(pendingPence)}`);
    if (payablePence <= 0) console.log('  nothing to pay this month; the balance carries forward');
    else
      console.log(`  after paying, run: bun run commissions --mark-paid=${payable.map((e) => e.id).join(',')} --apply`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Commission script failed');
  process.exitCode = 1;
});
