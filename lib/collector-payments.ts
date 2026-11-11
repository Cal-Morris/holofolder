import type Stripe from 'stripe';

/** Input history must be complete. A truncated history cannot prove a first payment. */
export function verifiedCollectorInvoices(invoices: Stripe.Invoice[], subscriptions: Set<string>, prices: string[]) {
  const result: Array<{
    invoiceId: string;
    subscriptionId: string;
    at: string;
    periodStart: string;
    periodEnd: string;
    renewal: boolean;
  }> = [];
  for (const invoice of invoices) {
    const reference = invoice.parent?.subscription_details?.subscription;
    const subscriptionId = typeof reference === 'string' ? reference : reference?.id;
    if (
      !subscriptionId ||
      !subscriptions.has(subscriptionId) ||
      invoice.status !== 'paid' ||
      invoice.currency !== 'gbp' ||
      invoice.amount_paid <= 0
    )
      continue;
    if (invoice.lines.has_more) throw new Error('Incomplete invoice lines cannot prove payment identity.');
    const paidAt = invoice.status_transitions?.paid_at;
    const lines = invoice.lines.data.filter(
      (line) =>
        prices.includes(line.pricing?.price_details?.price as string) &&
        line.amount > 0 &&
        line.period.end > line.period.start,
    );
    if (!lines.length) continue;
    if (!paidAt) throw new Error('Incomplete paid invoice time cannot prove a first payment.');
    // Never combine different service periods into a fabricated renewal period.
    const periods = new Set(lines.map((line) => `${line.period.start}:${line.period.end}`));
    if (periods.size !== 1) throw new Error('Incomplete service-period identity cannot prove a first payment.');
    result.push({
      invoiceId: invoice.id,
      subscriptionId,
      at: new Date(paidAt * 1000).toISOString(),
      periodStart: new Date(lines[0].period.start * 1000).toISOString(),
      periodEnd: new Date(lines[0].period.end * 1000).toISOString(),
      renewal: invoice.billing_reason === 'subscription_cycle',
    });
  }
  return result.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.invoiceId.localeCompare(b.invoiceId));
}
