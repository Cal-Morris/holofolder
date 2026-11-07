import type Stripe from 'stripe'

export function isHoloSubscription(subscription: Pick<Stripe.Subscription, 'metadata' | 'items'>, prices: string[]) {
  return subscription.metadata.app === 'holofolder' && subscription.items.data.length === 1
    && prices.includes(subscription.items.data[0].price.id) && subscription.items.data[0].quantity === 1
}
export function paidInvoiceThrough(invoice: Pick<Stripe.Invoice, 'status' | 'lines'>, prices: string[]) {
  if (invoice.status !== 'paid') return null
  const ends = invoice.lines.data.filter(line => prices.includes(line.pricing?.price_details?.price as string))
    .map(line => line.period.end).filter(end => Number.isFinite(end) && end > 0)
  return ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : null
}
