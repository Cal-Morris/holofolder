import { test } from 'node:test'
import assert from 'node:assert/strict'
import type Stripe from 'stripe'
import { isHoloSubscription, paidInvoiceThrough } from '../lib/billing-subscription'
// Synthetic Stripe objects, no actual account/customer/card data.
const subscription = (app: string, price: string, quantity = 1) => ({ metadata: { app }, items: { data: [{ price: { id: price }, quantity }] } }) as unknown as Stripe.Subscription
const invoice = (status: string, price: string) => ({ status, lines: { data: [{ pricing: { price_details: { price } }, period: { end: 2000000000 } }] } }) as unknown as Stripe.Invoice
test('only Holo Folder metadata and allowlisted single quantity prices are entitled', () => {
  assert.equal(isHoloSubscription(subscription('syncaura', 'monthly'), ['monthly']), false)
  assert.equal(isHoloSubscription(subscription('holofolder', 'other'), ['monthly']), false)
  assert.equal(isHoloSubscription(subscription('holofolder', 'monthly', 2), ['monthly']), false)
  assert.equal(isHoloSubscription(subscription('holofolder', 'monthly'), ['monthly']), true)
})
test('only paid invoices with Holo Folder prices advance paid time', () => {
  assert.equal(paidInvoiceThrough(invoice('open', 'monthly'), ['monthly']), null)
  assert.equal(paidInvoiceThrough(invoice('paid', 'other'), ['monthly']), null)
  assert.equal(paidInvoiceThrough(invoice('paid', 'monthly'), ['monthly']), new Date(2000000000000).toISOString())
})
