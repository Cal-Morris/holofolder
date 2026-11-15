import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { BillingContext, type BillingState } from '../hooks/use-billing';
import { BillingSettings } from '../components/billing-settings';
import { resolveBillingAccess, UNLIMITED_FREE_CARD_LIMIT } from '../lib/billing';
function render(
  source: 'free' | 'perpetual' | 'subscription' | 'trial',
  canManage = true,
  hasBillingAccount = false,
  freeCardLimit = 100,
  extra: { lifetimeAvailable?: boolean; subscriptionActive?: boolean } = { lifetimeAvailable: true },
  // After the launch offer by default, so the normal prices show.
  now = Date.parse('2027-01-01T00:00:00Z'),
) {
  const state: BillingState = {
    access: resolveBillingAccess('owner', {
      enforced: true,
      perpetual: source === 'perpetual',
      status: source === 'subscription' ? 'active' : 'none',
      trial_ends_at: source === 'trial' ? '2099-01-01' : null,
      paid_through: '2099-01-01',
      saved_card_count: 10,
      free_card_limit: freeCardLimit,
      free_binder_limit: 1,
    }),
    canManage,
    hasBillingAccount,
    subscriptionActive: extra.subscriptionActive ?? false,
    lifetimeAvailable: extra.lifetimeAvailable ?? false,
    loading: false,
    error: null,
    busy: false,
    premium: source !== 'free',
    refresh: async () => {},
    upgrade: () => {},
    checkout: async () => {},
    portal: async () => {},
  };
  return renderToStaticMarkup(
    <BillingContext.Provider value={state}>
      <BillingSettings signedIn onSignIn={() => {}} now={now} />
    </BillingContext.Provider>,
  );
}
test('lifetime plan shows permanent access without purchase or billing controls', () => {
  const html = render('perpetual');
  assert.match(html, /Lifetime access/);
  assert.doesNotMatch(html, /£3.99|£34.99|Manage billing/);
});
test('free plan shows both approved prices and the total card allowance', () => {
  const html = render('free');
  assert.match(html, /£3.99 \/ month/);
  assert.match(html, /£34.99 \/ year, save £12.89/);
  assert.match(html, /10 of 100 free entries/);
  assert.match(html, /1 free binder/);
});
test('unlimited free plan shows no entry count', () => {
  const html = render('free', true, false, UNLIMITED_FREE_CARD_LIMIT);
  assert.match(html, /Unlimited cards and wanted cards/);
  assert.doesNotMatch(html, /free entries/);
  assert.match(html, /1 free binder/);
});
test('only the billing owner gets subscription management controls', () => {
  assert.match(render('subscription'), /Manage billing/);
  assert.doesNotMatch(render('subscription', false), />Manage billing</);
  assert.match(render('subscription', false), /Your collection owner manages this plan/);
});

test('a subscriber later granted lifetime access can still stop their existing billing', () => {
  assert.match(render('perpetual', true, true), /Manage my existing billing/);
});
test('trial explains its expiry and no automatic charge, with optional purchase controls', () => {
  const html = render('trial');
  assert.match(html, /7-day Premium trial/);
  assert.match(html, /Trial ends/);
  assert.match(html, /No payment details needed/);
  assert.match(html, /won&#x27;t be charged automatically/);
  assert.match(html, /£3.99 \/ month/);
  assert.doesNotMatch(html, /Paid access until|>Manage billing</);
  assert.doesNotMatch(render('trial', false), /£3.99/);
});

test('lifetime is offered next to monthly and annual only once its price is configured', () => {
  assert.match(render('free'), /£79.00 once, lifetime access/);
  assert.doesNotMatch(render('free', true, false, 100, {}), /lifetime access/);
});
test('owners who already have lifetime are not offered it again', () => {
  assert.doesNotMatch(render('perpetual'), /£79/);
});
test('subscribers can buy lifetime and are told to cancel their subscription themselves', () => {
  const html = render('subscription');
  assert.match(html, /£79.00 once, lifetime access/);
  assert.match(html, /doesn&#x27;t cancel your subscription/);
  assert.match(
    render('perpetual', true, true, 100, { subscriptionActive: true }),
    /Your subscription is still active. Cancel it in Manage billing/,
  );
});

const duringOffer = Date.parse('2026-12-31T23:59:59Z');
test('during the launch offer the plan picker shows offer price, renewal price and end date', () => {
  const html = render('free', true, false, 100, { lifetimeAvailable: true }, duringOffer);
  assert.match(html, /Launch offer: 50% off, ends 31 December 2026/);
  assert.match(html, /£2.00 a month for 3 months, then £3.99 a month/);
  assert.match(html, /£17.50 for your first year, then £34.99 a year/);
  assert.match(html, /£39.50 until 31 December, then £79</);
  assert.match(html, /Have a creator code\?/);
  assert.doesNotMatch(html, /was|<s>|line-through/);
});
test('subscribers see the lifetime launch offer', () => {
  const html = render('subscription', true, false, 100, { lifetimeAvailable: true }, duringOffer);
  assert.match(html, /£39.50 until 31 December, then £79/);
  assert.doesNotMatch(html, /£2.00/);
});
test('after the end date the normal prices return with no offer copy', () => {
  const html = render('free', true, false, 100, { lifetimeAvailable: true }, duringOffer + 1000);
  assert.doesNotMatch(html, /Launch offer|creator code/);
  assert.match(html, /£3.99 \/ month/);
});
