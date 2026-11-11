import 'server-only';
import type Stripe from 'stripe';
import { getStripe, billingRecognizedPriceIds } from '@/lib/server/stripe';
import { isHoloSubscription } from '@/lib/billing-subscription';
import { verifiedCollectorInvoices } from '@/lib/collector-payments';
import { collectorFunnelEnabled, observeCollectorAccount, recordCollectorEvent } from '@/lib/server/collector-funnel';

/** Bounded read-only Stripe history, also usable by the explicit operator backfill. */
export async function recordCollectorPayments(ownerId: string, customerId: string) {
  if (!collectorFunnelEnabled()) return { observed: 0, reason: 'tracking disabled' };
  const stripe = getStripe(),
    prices = billingRecognizedPriceIds();
  const subscriptionIds = new Set<string>();
  let count = 0;
  for await (const sub of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
    if (++count > 500) return { observed: 0, reason: 'subscription history exceeds the verification bound' };
    if (isHoloSubscription(sub, prices)) subscriptionIds.add(sub.id);
  }
  const invoices: Stripe.Invoice[] = [];
  for await (const invoice of stripe.invoices.list({ customer: customerId, status: 'paid', limit: 100 })) {
    if (invoices.length >= 500) return { observed: 0, reason: 'invoice history exceeds the verification bound' };
    invoices.push(invoice);
  }
  const verified = verifiedCollectorInvoices(invoices, subscriptionIds, prices);
  if (!verified.length) return { observed: 0, reason: 'no verified positive Holo Folder invoices' };
  await observeCollectorAccount(ownerId, true, new Date().toISOString());
  let observed = 0;
  const granularCutoff = Date.now() - 90 * 86400000;
  for (const [index, invoice] of verified.entries()) {
    const input = {
      actorId: ownerId,
      ownerId,
      at: invoice.at,
      subscriptionId: invoice.subscriptionId,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
    };
    let recorded = false;
    if (index === 0) recorded = await recordCollectorEvent({ ...input, name: 'first_paid', key: 'first_paid' });
    // Replaying or backfilling history must not recreate granular rows after retention cleanup.
    if (Date.parse(invoice.at) >= granularCutoff) {
      if (await recordCollectorEvent({ ...input, name: 'paid_invoice', key: `invoice:${invoice.invoiceId}` }))
        recorded = true;
      if (index !== 0 && invoice.renewal)
        await recordCollectorEvent({ ...input, name: 'renewed', key: `renewal:${invoice.invoiceId}` });
    }
    if (recorded) observed++;
  }
  return { observed };
}

export async function recordCollectorCancellation(ownerId: string, subscriptionId: string, eventTime: number) {
  if (!collectorFunnelEnabled()) return;
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  if (!isHoloSubscription(sub, billingRecognizedPriceIds())) return;
  const name =
    sub.status === 'canceled' ? 'cancelled' : sub.cancel_at_period_end || sub.cancel_at ? 'cancel_scheduled' : null;
  if (!name) return;
  const stamp = name === 'cancelled' ? (sub.ended_at ?? sub.canceled_at ?? eventTime) : (sub.canceled_at ?? eventTime);
  await recordCollectorEvent({
    actorId: ownerId,
    ownerId,
    name,
    subscriptionId: sub.id,
    key: `${name}:${sub.id}:${stamp}`,
    at: new Date(stamp * 1000).toISOString(),
  });
}
