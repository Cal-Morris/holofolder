import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBillingAccess } from '@/lib/server/billing';
import { getStripe, billingPriceIds, billingRecognizedPriceIds, billingReturnUrl } from '@/lib/server/stripe';
import {
  assertCheckoutPrice,
  canReuseCheckout,
  isHoloSubscription,
  paidInvoiceThrough,
} from '@/lib/billing-subscription';
import {
  scheduleCollectorTracking,
  observeCollectorAccount,
  recordCollectorEvent,
} from '@/lib/server/collector-funnel';
import { recordCollectorPayments, recordCollectorCancellation } from '@/lib/server/collector-payments';

async function withBillingLock<T>(ownerId: string, action: (token: string) => Promise<T>): Promise<T> {
  const admin = createAdminClient(),
    token = crypto.randomUUID();
  const { data, error } = await admin.rpc('claim_billing_lock', { owner_id: ownerId, token });
  if (error || !data) throw new Error('Billing is already updating. Try again shortly.');
  try {
    return await action(token);
  } finally {
    await admin
      .from('billing_accounts')
      .update({ lock_token: null, locked_until: null })
      .eq('owner_user_id', ownerId)
      .eq('lock_token', token);
  }
}
async function readAccount(ownerId: string) {
  const { data, error } = await createAdminClient()
    .from('billing_accounts')
    .select('*')
    .eq('owner_user_id', ownerId)
    .single();
  if (error) throw new Error('Billing account could not be loaded');
  return data;
}
async function subscriptions(customer: string) {
  const stripe = getStripe(),
    prices = billingRecognizedPriceIds();
  const result: Stripe.Subscription[] = [];
  for await (const sub of stripe.subscriptions.list({ customer, status: 'all', limit: 100 })) {
    if (isHoloSubscription(sub, prices)) result.push(sub);
  }
  return result.sort((a, b) => b.created - a.created);
}
async function reconcileLocked(ownerId: string, token: string, eventId?: string) {
  const account = await readAccount(ownerId);
  if (!account.stripe_customer_id) return;
  const subs = await subscriptions(account.stripe_customer_id);
  const sub = subs.find((s) => ['active', 'past_due'].includes(s.status)) ?? subs[0];
  let paidUntil: string | null = null;
  if (sub && ['active', 'past_due'].includes(sub.status)) {
    for await (const invoice of getStripe().invoices.list({
      customer: account.stripe_customer_id,
      subscription: sub.id,
      status: 'paid',
      limit: 100,
    })) {
      const end = paidInvoiceThrough(invoice, billingRecognizedPriceIds());
      if (end && (!paidUntil || end > paidUntil)) paidUntil = end;
      // Most recent paid invoice is sufficient for this fixed monthly/annual plan.
      if (paidUntil) break;
    }
  }
  const { data, error } = await createAdminClient().rpc('commit_billing_state', {
    owner_id: ownerId,
    token,
    customer_id: account.stripe_customer_id,
    subscription_id: sub?.id ?? null,
    subscription_status: sub?.status ?? 'none',
    paid_until: paidUntil,
    event: eventId ?? null,
  });
  if (error || !data) throw new Error('Billing changed during reconciliation. Retry this event.');
}
export async function reconcileBilling(ownerId: string, eventId?: string) {
  await withBillingLock(ownerId, (token) => reconcileLocked(ownerId, token, eventId));
}
export async function startCheckout(ownerId: string, email: string | undefined, interval: 'month' | 'year') {
  return withBillingLock(ownerId, async (token) => {
    if ((await getBillingAccess(ownerId)).source === 'perpetual')
      throw new Error('Your account already has lifetime access.');
    const stripe = getStripe(),
      price = billingPriceIds()[interval],
      admin = createAdminClient();
    assertCheckoutPrice(await stripe.prices.retrieve(price, { expand: ['product'] }), interval);
    let account = await readAccount(ownerId);
    if (!account.stripe_customer_id) {
      const customer = await stripe.customers.create(
        { email, metadata: { app: 'holofolder', owner_user_id: ownerId } },
        { idempotencyKey: `holofolder-customer:${ownerId}` },
      );
      const { data, error } = await admin
        .from('billing_accounts')
        .update({ stripe_customer_id: customer.id })
        .eq('owner_user_id', ownerId)
        .eq('lock_token', token)
        .gt('locked_until', new Date().toISOString())
        .select('owner_user_id')
        .maybeSingle();
      if (error || !data) throw new Error('Customer could not be linked. Try again.');
      account = { ...account, stripe_customer_id: customer.id };
    }
    if (
      (await subscriptions(account.stripe_customer_id)).some(
        (s) => !['canceled', 'incomplete_expired'].includes(s.status),
      )
    ) {
      throw new Error('You already have a subscription. Use Manage billing.');
    }
    let reuse: Stripe.Checkout.Session | undefined;
    for await (const session of stripe.checkout.sessions.list({
      customer: account.stripe_customer_id,
      status: 'open',
      limit: 100,
    })) {
      if (session.metadata?.app !== 'holofolder') continue;
      const lines = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
      if (!reuse && canReuseCheckout(session, ownerId, interval, price, lines)) reuse = session;
      else await stripe.checkout.sessions.expire(session.id);
    }
    if (reuse?.url) return reuse.url;
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: account.stripe_customer_id,
        client_reference_id: ownerId,
        metadata: { app: 'holofolder', interval, owner_user_id: ownerId, price_id: price },
        subscription_data: { metadata: { app: 'holofolder', owner_user_id: ownerId } },
        line_items: [{ price, quantity: 1 }],
        success_url: billingReturnUrl(),
        cancel_url: billingReturnUrl(),
      },
      { idempotencyKey: `holofolder-checkout:${ownerId}:${interval}:${token}` },
    );
    if (!session.url) throw new Error('Checkout could not be opened');
    scheduleCollectorTracking(async () => {
      const at = new Date(session.created * 1000).toISOString();
      await observeCollectorAccount(ownerId, true, at);
      await recordCollectorEvent({
        actorId: ownerId,
        ownerId,
        name: 'checkout_created',
        key: `checkout:${session.id}`,
        at,
      });
    });
    return session.url;
  });
}
export async function openBillingPortal(ownerId: string) {
  const account = await readAccount(ownerId);
  const configuration = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  if (!account.stripe_customer_id || !configuration)
    throw new Error('Billing portal is not available for this account.');
  const portal = await getStripe().billingPortal.sessions.create({
    customer: account.stripe_customer_id,
    configuration,
    return_url: billingReturnUrl(),
  });
  return portal.url;
}
export async function handleBillingEvent(event: Stripe.Event) {
  const stripeLive = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? '');
  if (event.livemode !== stripeLive) throw new Error('Stripe event mode does not match');
  if (
    ![
      'invoice.paid',
      'invoice.payment_failed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'checkout.session.completed',
    ].includes(event.type)
  )
    return;
  const object = event.data.object as { customer?: string | { id: string } };
  const customer = typeof object.customer === 'string' ? object.customer : object.customer?.id;
  if (!customer) return;
  const admin = createAdminClient();
  const { data: prior, error: priorError } = await admin
    .from('billing_events')
    .select('event_id')
    .eq('event_id', event.id)
    .maybeSingle();
  if (priorError) throw new Error('Event receipt could not be checked');
  if (prior) return;
  const { data: account, error } = await admin
    .from('billing_accounts')
    .select('owner_user_id')
    .eq('stripe_customer_id', customer)
    .maybeSingle();
  if (error) throw new Error('Event account could not be checked');
  if (account) {
    await reconcileBilling(account.owner_user_id, event.id);
    if (event.type === 'invoice.paid')
      scheduleCollectorTracking(() => recordCollectorPayments(account.owner_user_id, customer));
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscriptionId = (event.data.object as Stripe.Subscription).id;
      scheduleCollectorTracking(() =>
        recordCollectorCancellation(account.owner_user_id, subscriptionId, event.created),
      );
    }
  }
}
