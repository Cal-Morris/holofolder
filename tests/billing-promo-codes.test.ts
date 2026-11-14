import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePromoCode, parsePromoCodeRequest, promoCouponId, promoCouponName } from '../lib/billing-promo-codes';

test('a creator lifetime code and an audience code parse into the expected coupons', () => {
  const lifetime = parsePromoCodeRequest({ plan: 'lifetime', code: 'ash-lifetime', percent: '100', 'max-uses': '1' });
  assert.equal(lifetime.code, 'ASH-LIFETIME');
  assert.equal(promoCouponId(lifetime), 'holofolder-creator-lifetime');
  assert.match(describePromoCode(lifetime), /100% off the first payment, Lifetime .* max 1 use$/);
  const audience = parsePromoCodeRequest({
    plan: 'monthly',
    code: 'ASH',
    percent: '100',
    duration: 'repeating',
    months: '1',
    'first-time': true,
    creator: 'ash',
  });
  assert.equal(promoCouponId(audience), 'holofolder-creator-audience');
  assert.equal(promoCouponName(audience), '100% off for 1 month');
  assert.match(describePromoCode(audience), /unlimited uses, first-time customers only, creator ash/);
  const amount = parsePromoCodeRequest({ plan: 'lifetime', code: 'SHOW-TEN', 'amount-off': '1000' });
  assert.equal(promoCouponId(amount), 'holofolder-lifetime-gbp1000-once');
  assert.equal(promoCouponName(amount), '£10.00 off the first payment');
  const half = parsePromoCodeRequest({ plan: 'monthly', code: 'HALF', percent: '50', duration: 'forever' });
  assert.equal(promoCouponId(half), 'holofolder-monthly-pct50-forever');
});

test('requests that could not be redeemed or are ambiguous are refused', () => {
  const base = { plan: 'monthly', code: 'OK-CODE', percent: '50' };
  for (const bad of [
    { ...base, plan: 'year' },
    { ...base, code: 'no spaces' },
    { ...base, 'amount-off': '100' },
    { plan: 'monthly', code: 'OK-CODE' },
    { ...base, percent: '150' },
    { ...base, duration: 'repeating' },
    { ...base, months: '3' },
    { ...base, plan: 'lifetime', duration: 'forever' },
    { ...base, expires: '2001-01-01' },
    { ...base, 'max-uses': '0' },
  ])
    assert.throws(() => parsePromoCodeRequest(bad), JSON.stringify(bad));
});
