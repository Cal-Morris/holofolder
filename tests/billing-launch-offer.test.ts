import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_LIFETIME_PRICE,
  BILLING_PRICES,
  LAUNCH_OFFER,
  launchOfferActive,
  launchOfferCoupon,
  planChoice,
} from '../lib/billing';

const end = Date.parse('2026-12-31T23:59:59Z');

test('the offer runs until 23:59:59 on 31 December 2026 London time and then switches off', () => {
  assert.equal(LAUNCH_OFFER.endsAt, end);
  assert.equal(launchOfferActive(Date.parse('2026-11-15T12:00:00Z')), true);
  assert.equal(launchOfferActive(end), true);
  assert.equal(launchOfferActive(end + 1000), false);
  assert.equal(launchOfferActive(Date.parse('2027-01-01T00:00:00Z')), false);
});

test('offer prices are exactly half the normal price, rounded to whole pence', () => {
  assert.deepEqual(LAUNCH_OFFER.price, { month: 200, year: 1750, lifetime: 3950 });
  for (const [plan, normal] of Object.entries({ ...BILLING_PRICES, lifetime: BILLING_LIFETIME_PRICE }))
    assert.equal(LAUNCH_OFFER.price[plan as keyof typeof LAUNCH_OFFER.price], Math.round(normal / 2));
});

test('each plan gets its own coupon while the offer is active', () => {
  const now = Date.parse('2026-12-01T00:00:00Z');
  assert.equal(launchOfferCoupon('month', false, now), 'holofolder-launch-2026-month');
  assert.equal(launchOfferCoupon('year', false, now), 'holofolder-launch-2026-year');
  assert.equal(launchOfferCoupon('lifetime', false, now), 'holofolder-launch-2026-lifetime');
});

test('a promotion code replaces the coupon on monthly and lifetime, never stacking; annual has no code box', () => {
  const now = Date.parse('2026-12-01T00:00:00Z');
  assert.equal(launchOfferCoupon('month', true, now), null);
  assert.equal(launchOfferCoupon('lifetime', true, now), null);
  assert.equal(launchOfferCoupon('year', true, now), 'holofolder-launch-2026-year');
});

test('after the end date no plan gets a coupon', () => {
  for (const plan of ['month', 'year', 'lifetime'] as const)
    assert.equal(launchOfferCoupon(plan, false, end + 1), null);
});

test('plan choices show the price paid now and what it renews at, never a "was" price', () => {
  assert.deepEqual(planChoice('month', true), { title: '£2.00 / month', detail: 'For 3 months, then £3.99' });
  assert.deepEqual(planChoice('year', true), { title: '£17.50 first year', detail: 'Then £34.99' });
  assert.deepEqual(planChoice('lifetime', true), {
    title: '£39.50 once',
    detail: 'Lifetime access, normally £79.00',
  });
  assert.deepEqual(planChoice('month', false), { title: '£3.99 / month', detail: 'Billed monthly' });
  assert.deepEqual(planChoice('year', false), { title: '£34.99 / year', detail: 'Save £12.89 on monthly' });
  assert.deepEqual(planChoice('lifetime', false), { title: '£79.00 once', detail: 'Lifetime access, no subscription' });
});
