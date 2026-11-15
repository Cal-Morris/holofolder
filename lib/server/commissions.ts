import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/fetch-all-rows';
import { getStripe, billingRecognizedPriceIds } from '@/lib/server/stripe';
import {
  chargeStillPaid,
  chooseAffiliate,
  invoiceEarning,
  lifetimeEarning,
  summariseEarnings,
  type AffiliateCandidate,
  type CommissionEarning,
  type CustomerAttribution,
} from '@/lib/commissions';

// Before migration 140 every step is a no-op, so billing webhooks keep working.
const MISSING = ['PGRST202', 'PGRST205', '42883', '42P01'];
const missing = (error: { code?: string } | null) => Boolean(error && MISSING.includes(error.code ?? ''));
function check<T>(result: { data: T; error: { code?: string; message?: string } | null }, what: string) {
  if (result.error && !missing(result.error)) throw new Error(`${what} failed. Retry this event.`);
  return result.error ? null : result.data;
}

const ref = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : value?.id);

async function attribution(customerId: string): Promise<CustomerAttribution | null> {
  const row = check(
    await createAdminClient()
      .from('affiliate_customers')
      .select('affiliate_owner_id,attributed_at,affiliates!inner(active)')
      .eq('customer_owner_id', customerId)
      .eq('affiliates.active', true)
      .maybeSingle(),
    'Commission attribution read',
  );
  return row ? { affiliateId: row.affiliate_owner_id, customerId, attributedAt: row.attributed_at } : null;
}

async function candidate(ownerId: string | undefined, payoutEmail: string): Promise<AffiliateCandidate | null> {
  if (!ownerId) return null;
  const admin = createAdminClient();
  const [{ data: user, error }, account] = await Promise.all([
    admin.auth.admin.getUserById(ownerId),
    admin.from('billing_accounts').select('stripe_customer_id').eq('owner_user_id', ownerId).maybeSingle(),
  ]);
  if (error || account.error) throw new Error('Affiliate could not be checked. Retry this event.');
  return {
    ownerId,
    emails: [user.user?.email ?? null, payoutEmail],
    stripeCustomerId: account.data?.stripe_customer_id,
  };
}

/**
 * Decides once, at a completed Checkout, which affiliate (if any) this customer belongs to. Skipped when the customer
 * already has one, when no active affiliate is involved (no extra reads for ordinary sign-ups), or when the Stripe
 * customer has paid before. The primary key makes it first touch even if two events race.
 */
export async function attributeCheckout(customerId: string, session: Stripe.Checkout.Session) {
  const admin = createAdminClient();
  const existing = await admin
    .from('affiliate_customers')
    .select('customer_owner_id')
    .eq('customer_owner_id', customerId)
    .maybeSingle();
  if (missing(existing.error)) return 'unavailable';
  if (existing.error) throw new Error('Commission attribution read failed. Retry this event.');
  if (existing.data) return 'already_attributed';
  const promotionCodeId = ref(session.discounts?.find((d) => d.promotion_code)?.promotion_code);
  const [referral, coded] = await Promise.all([
    admin.from('referrals').select('inviter_user_id').eq('invitee_user_id', customerId).maybeSingle(),
    promotionCodeId
      ? admin
          .from('affiliates')
          .select('owner_user_id,payout_email')
          .eq('stripe_promotion_code_id', promotionCodeId)
          .eq('active', true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (referral.error && !missing(referral.error)) throw new Error('Referral read failed. Retry this event.');
  if (coded.error) throw new Error('Affiliate read failed. Retry this event.');
  const inviter = referral.data?.inviter_user_id;
  const invited = inviter
    ? check(
        await admin
          .from('affiliates')
          .select('owner_user_id,payout_email')
          .eq('owner_user_id', inviter)
          .eq('active', true)
          .maybeSingle(),
        'Affiliate read',
      )
    : null;
  if (!invited && !coded.data) return 'no_affiliate';

  const stripeCustomer = ref(session.customer) ?? null;
  const [invitedBy, codeOwner, user, partners, paidBefore] = await Promise.all([
    candidate(invited?.owner_user_id, invited?.payout_email ?? ''),
    candidate(coded.data?.owner_user_id, coded.data?.payout_email ?? ''),
    admin.auth.admin.getUserById(customerId),
    admin
      .from('partnerships')
      .select('user1_id,user2_id')
      .or(`user1_id.eq.${customerId},user2_id.eq.${customerId}`)
      .limit(100),
    stripeCustomer ? paidBeforeCheckout(stripeCustomer, session.created) : false,
  ]);
  if (user.error || partners.error) throw new Error('Customer could not be checked. Retry this event.');
  const choice = chooseAffiliate({
    customerId,
    customerStripeId: stripeCustomer,
    customerEmails: [user.data.user?.email ?? null, session.customer_details?.email ?? null],
    paidBefore,
    invitedBy,
    codeOwner,
    partners: partners.data.flatMap((p) => [p.user1_id, p.user2_id]),
  });
  if ('rejected' in choice) return choice.rejected;
  const { error } = await admin.from('affiliate_customers').upsert(
    {
      customer_owner_id: customerId,
      affiliate_owner_id: choice.affiliateId,
      source: choice.source,
      stripe_checkout_session_id: session.id,
      attributed_at: new Date(session.created * 1000).toISOString(),
    },
    { onConflict: 'customer_owner_id', ignoreDuplicates: true },
  );
  if (error) throw new Error('Commission attribution failed. Retry this event.');
  return 'attributed';
}

/** Any succeeded, positive charge on this Stripe customer before the Checkout started means they already paid. */
async function paidBeforeCheckout(customer: string, before: number) {
  for await (const charge of getStripe().charges.list({ customer, created: { lt: before }, limit: 100 }))
    if (charge.status === 'succeeded' && charge.amount > 0) return true;
  return false;
}

async function recordEarning(entry: CommissionEarning | null) {
  if (!entry) return;
  const { error } = await createAdminClient()
    .from('commission_entries')
    .upsert(entry, { onConflict: 'stripe_object_id', ignoreDuplicates: true });
  if (error && !missing(error)) throw new Error('Commission could not be recorded. Retry this event.');
}

/**
 * invoice.paid: 30% of the amount paid, for an attributed customer within their 12 months. The first invoice of a
 * subscription can arrive before checkout.session.completed, so attribution runs here too from that Checkout.
 */
export async function recordInvoiceCommission(customerId: string, paid: Stripe.Invoice) {
  if (!paid.id || !(paid.amount_paid > 0) || paid.currency !== 'gbp') return;
  let attributed = await attribution(customerId);
  const subscription = ref(paid.parent?.subscription_details?.subscription);
  if (!attributed && paid.billing_reason === 'subscription_create' && subscription) {
    const [session] = (await getStripe().checkout.sessions.list({ subscription, limit: 1, expand: ['data.discounts'] }))
      .data;
    if (session?.status === 'complete' && session.metadata?.app === 'holofolder') {
      await attributeCheckout(customerId, session);
      attributed = await attribution(customerId);
    }
  }
  if (!attributed) return;
  const invoice = await getStripe().invoices.retrieve(paid.id, { expand: ['payments'] });
  await recordEarning(invoiceEarning(invoice, attributed, billingRecognizedPriceIds()));
}

/** A verified, positive lifetime Checkout. Runs before the licence grant so a retry still records it. */
export async function recordLifetimeCommission(customerId: string, session: Stripe.Checkout.Session) {
  const attributed = await attribution(customerId);
  if (attributed) await recordEarning(lifetimeEarning(session, attributed));
}

/**
 * charge.refunded and charge.dispute.*: move the earning to 30% of what the customer still has paid. The charge and its
 * disputes are read fresh, so any order of events lands on the same total; the event id makes a replay a no-op.
 */
export async function recordCommissionAdjustment(event: Stripe.Event) {
  const object = event.data.object as { object?: string; id?: string; charge?: string | { id: string } };
  const chargeId = object.object === 'charge' ? object.id : ref(object.charge);
  if (!chargeId) return;
  const stripe = getStripe();
  const charge = await stripe.charges.retrieve(chargeId);
  const disputes: string[] = [];
  if (charge.disputed)
    for await (const dispute of stripe.disputes.list({ charge: chargeId, limit: 100 })) disputes.push(dispute.status);
  const { paymentRef, remainingPaid } = chargeStillPaid(charge, disputes);
  const { error } = await createAdminClient().rpc('commission_adjust_v1', {
    payment_ref: paymentRef,
    adjustment_key: `adjust:${event.id}`,
    remaining_paid: remainingPaid,
    adjusted_at: new Date(event.created * 1000).toISOString(),
  });
  if (error && !missing(error)) throw new Error('Commission adjustment failed. Retry this event.');
}

/** Settings → Plan, for enrolled affiliates only: their code, how many customers, and totals. No customer details. */
export async function earningsSummary(ownerId: string) {
  const admin = createAdminClient();
  const affiliate = check(
    await admin.from('affiliates').select('promotion_code,active').eq('owner_user_id', ownerId).maybeSingle(),
    'Affiliate read',
  );
  if (!affiliate) return null;
  const [customers, entries] = await Promise.all([
    admin
      .from('affiliate_customers')
      .select('customer_owner_id', { count: 'exact', head: true })
      .eq('affiliate_owner_id', ownerId),
    fetchAllRows<{ commission_pence: number; status: string; hold_until: string }>((from, to) =>
      admin
        .from('commission_entries')
        .select('commission_pence,status,hold_until')
        .eq('affiliate_owner_id', ownerId)
        .order('id')
        .range(from, to),
    ),
  ]);
  if (customers.error || entries.error) throw new Error('Earnings could not be loaded');
  return {
    code: affiliate.promotion_code,
    active: affiliate.active,
    customers: customers.count ?? 0,
    ...summariseEarnings(entries.data),
  };
}
