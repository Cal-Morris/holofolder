import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_LIFETIME_PRICE,
  BILLING_PRICES,
  LAUNCH_OFFER,
  launchOfferActive,
  launchOfferCoupon,
  launchOfferText,
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

test('the offer wording names the offer price, the normal price and never a "was" price', () => {
  assert.equal(launchOfferText('year'), 'Launch offer: £17.50 for your first year, then £34.99 a year');
  assert.equal(launchOfferText('month'), 'Launch offer: £2.00 a month for 3 months, then £3.99 a month');
  assert.equal(launchOfferText('lifetime'), 'Launch offer: £39.50 until 31 December, then £79');
});
