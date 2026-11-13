import type Stripe from 'stripe';
import { BILLING_PRICES } from '@/lib/billing';

export function recognizedBillingPriceIds(current: { month: string; year: string }, legacy = '') {
  const ids = [
    ...Object.values(current),
    ...legacy.split(',').flatMap((value) => {
      const id = value.trim();
      return id ? [id] : [];
    }),
  ];
  if (legacy.length > 2048 || ids.length > 22 || ids.some((id) => !/^price_[A-Za-z0-9_]{1,100}$/.test(id)))
    throw new Error('Invalid subscription price configuration');
  return [...new Set(ids)];
}

/** Validate the expanded product and immutable amount before a new sale. */
export function assertCheckoutPrice(price: Stripe.Price, interval: 'month' | 'year') {
  const product = typeof price.product === 'string' ? null : price.product;
  if (
    !price.active ||
    price.type !== 'recurring' ||
    price.currency !== 'gbp' ||
    price.unit_amount !== BILLING_PRICES[interval] ||
    price.recurring?.interval !== interval ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== 'licensed' ||
    price.billing_scheme !== 'per_unit' ||
    price.transform_quantity ||
    price.metadata.app !== 'holofolder' ||
    !product ||
    product.deleted ||
    !product.active ||
    product.metadata.app !== 'holofolder'
  )
    throw new Error('Subscription pricing is temporarily unavailable. Try again shortly.');
}

export function canReuseCheckout(
  session: Stripe.Checkout.Session,
  ownerId: string,
  interval: 'month' | 'year',
  priceId: string,
  lines: Stripe.ApiList<Stripe.LineItem>,
) {
  return (
    session.status === 'open' &&
    session.mode === 'subscription' &&
    session.metadata?.app === 'holofolder' &&
    session.metadata.owner_user_id === ownerId &&
    session.client_reference_id === ownerId &&
    session.metadata.interval === interval &&
    Boolean(session.url) &&
    !lines.has_more &&
    lines.data.length === 1 &&
    lines.data[0].quantity === 1 &&
    lines.data[0].price?.id === priceId
  );
}

export function isHoloSubscription(subscription: Pick<Stripe.Subscription, 'metadata' | 'items'>, prices: string[]) {
  return (
    subscription.metadata.app === 'holofolder' &&
    subscription.items.data.length === 1 &&
    prices.includes(subscription.items.data[0].price.id) &&
    subscription.items.data[0].quantity === 1
  );
}
export function paidInvoiceThrough(invoice: Pick<Stripe.Invoice, 'status' | 'lines'>, prices: string[]) {
  if (invoice.status !== 'paid') return null;
  const priceIds = new Set(prices);
  const ends = invoice.lines.data.flatMap((line) => {
    const end = line.period.end;
    return priceIds.has(line.pricing?.price_details?.price as string) && Number.isFinite(end) && end > 0 ? [end] : [];
  });
  return ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : null;
}
