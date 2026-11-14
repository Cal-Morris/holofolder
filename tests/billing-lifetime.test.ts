import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { BILLING_LIFETIME_PRICE } from '../lib/billing';
import { assertLifetimePrice, fulfilLifetimeCheckout, type LifetimeGrant } from '../lib/billing-lifetime';
import { canReuseCheckout } from '../lib/billing-subscription';

// Synthetic Stripe objects, no actual account, customer, code or card data.
const price = {
  active: true,
  type: 'one_time',
  currency: 'gbp',
  unit_amount: 7900,
  billing_scheme: 'per_unit',
  transform_quantity: null,
  metadata: { app: 'holofolder', plan: 'lifetime' },
  product: { active: true, metadata: { app: 'holofolder', plan: 'lifetime' } },
} as unknown as Stripe.Price;
const session = (patch: Record<string, unknown> = {}) =>
  ({
    id: 'cs_synthetic',
    created: 2000000000,
    mode: 'payment',
    status: 'complete',
    currency: 'gbp',
    payment_status: 'paid',
    amount_subtotal: 7900,
    amount_total: 7900,
    client_reference_id: 'owner',
    metadata: { app: 'holofolder', interval: 'lifetime', owner_user_id: 'owner', price_id: 'price_life' },
    discounts: [],
    line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_life' } }] },
    ...patch,
  }) as unknown as Stripe.Checkout.Session;

function harness(existing = false) {
  const grants: LifetimeGrant[] = [],
    firstPaid: string[] = [];
  const owned = new Set(existing ? ['owner'] : []);
  return {
    grants,
    firstPaid,
    run: (s: Stripe.Checkout.Session) =>
      fulfilLifetimeCheckout(s, {
        priceId: 'price_life',
        ownerId: 'owner',
        grant: async (grant) => {
          // Mirrors the owner_user_id primary key with ON CONFLICT DO NOTHING.
          if (owned.has(grant.ownerId)) return false;
          owned.add(grant.ownerId);
          grants.push(grant);
          return true;
        },
        recordFirstPaid: async (at) => firstPaid.push(at),
      }),
  };
}

test('lifetime price and product must match the shared constants exactly', () => {
  assert.equal(BILLING_LIFETIME_PRICE, 7900);
  assert.doesNotThrow(() => assertLifetimePrice(price));
  for (const patch of [
    { unit_amount: 3499 },
    { currency: 'usd' },
    { type: 'recurring' },
    { active: false },
    { metadata: { app: 'holofolder' } },
    { product: { active: true, metadata: { app: 'holofolder' } } },
    { product: 'prod_unexpanded' },
  ])
    assert.throws(() => assertLifetimePrice({ ...price, ...patch } as Stripe.Price));
});

test('a paid £79 checkout grants lifetime and records first paid', async () => {
  const h = harness();
  assert.equal(await h.run(session()), 'granted');
  assert.deepEqual(h.grants, [
    { ownerId: 'owner', sessionId: 'cs_synthetic', promotionCodeId: null, amountPaid: 7900, at: h.firstPaid[0] },
  ]);
  assert.equal(h.firstPaid.length, 1);
});

test('a £0 checkout with a 100% promotion code grants lifetime but is not revenue', async () => {
  const h = harness();
  const free = session({
    payment_status: 'no_payment_required',
    amount_total: 0,
    discounts: [{ coupon: 'creator_lifetime', promotion_code: 'promo_synthetic' }],
  });
  assert.equal(await h.run(free), 'granted');
  assert.equal(h.grants[0].promotionCodeId, 'promo_synthetic');
  assert.deepEqual(h.firstPaid, []);
});

test('a £0 checkout reported as paid, as live Stripe does, grants lifetime but is not revenue', async () => {
  const h = harness();
  const free = session({
    payment_status: 'paid',
    amount_total: 0,
    discounts: [{ coupon: null, promotion_code: 'promo_synthetic' }],
  });
  assert.equal(await h.run(free), 'granted');
  assert.equal(h.grants[0].amountPaid, 0);
  assert.deepEqual(h.firstPaid, []);
});

test('£0 without a promotion code, unpaid or wrong price/owner/amount grants nothing', async () => {
  for (const patch of [
    { payment_status: 'no_payment_required', amount_total: 0 },
    { payment_status: 'paid', amount_total: 0 },
    { payment_status: 'unpaid' },
    { line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_month' } }] } },
    { line_items: { has_more: false, data: [{ quantity: 2, price: { id: 'price_life' } }] } },
    { amount_subtotal: 399 },
    { client_reference_id: 'someone-else' },
    { metadata: { app: 'syncaura', interval: 'lifetime', owner_user_id: 'owner' } },
    { mode: 'subscription' },
  ]) {
    const h = harness();
    assert.equal(await h.run(session(patch)), 'rejected', JSON.stringify(patch));
    assert.deepEqual(h.grants, []);
    assert.deepEqual(h.firstPaid, []);
  }
});

test('a replayed event grants and counts once', async () => {
  const h = harness();
  assert.equal(await h.run(session()), 'granted');
  assert.equal(await h.run(session()), 'already_lifetime');
  assert.equal(h.grants.length, 1);
  assert.equal(h.firstPaid.length, 1);
});

test('an owner who already has lifetime is left as is', async () => {
  const h = harness(true);
  assert.equal(await h.run(session()), 'already_lifetime');
  assert.deepEqual(h.grants, []);
  assert.deepEqual(h.firstPaid, []);
});

test('an open lifetime Checkout is only reused for lifetime in payment mode', () => {
  const open = session({
    status: 'open',
    url: 'https://checkout.stripe.com/synthetic',
  });
  const lines = open.line_items!;
  assert.equal(canReuseCheckout(open, 'owner', 'lifetime', 'price_life', lines), true);
  assert.equal(canReuseCheckout(open, 'owner', 'month', 'price_life', lines), false);
  assert.equal(canReuseCheckout({ ...open, mode: 'subscription' }, 'owner', 'lifetime', 'price_life', lines), false);
});
