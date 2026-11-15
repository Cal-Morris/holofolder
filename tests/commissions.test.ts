import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import {
  chargeStillPaid,
  chooseAffiliate,
  commissionPence,
  invoiceEarning,
  lifetimeEarning,
  normaliseEmail,
  summariseEarnings,
  type AttributionInput,
} from '../lib/commissions';

// Synthetic ids and emails only, no real Stripe or account data.
const customer = '00000000-0000-4000-8000-00000000000c';
const creator = {
  ownerId: '00000000-0000-4000-8000-0000000000a1',
  emails: ['ash@creator.test', 'payouts@creator.test'],
  stripeCustomerId: 'cus_creator',
};
const partner = {
  ownerId: '00000000-0000-4000-8000-0000000000b2',
  emails: ['sam@partner.test', null],
  stripeCustomerId: null,
};
const base: AttributionInput = {
  customerId: customer,
  customerStripeId: 'cus_customer',
  customerEmails: ['fan@example.test', 'fan@example.test'],
  paidBefore: false,
  invitedBy: null,
  codeOwner: null,
  partners: [],
};
const attributedAt = '2026-11-15T00:00:00.000Z';
const attribution = { affiliateId: creator.ownerId, customerId: customer, attributedAt };
const unix = (iso: string) => Date.parse(iso) / 1000;

describe('attribution', () => {
  test('nobody earns without an active affiliate involved', () => {
    assert.deepEqual(chooseAffiliate(base), { rejected: 'no_affiliate' });
  });
  test('a code owner earns, an invite link earns, and the invite wins as first touch', () => {
    assert.deepEqual(chooseAffiliate({ ...base, codeOwner: creator }), {
      affiliateId: creator.ownerId,
      source: 'promotion_code',
    });
    assert.deepEqual(chooseAffiliate({ ...base, invitedBy: partner }), {
      affiliateId: partner.ownerId,
      source: 'invite',
    });
    assert.deepEqual(chooseAffiliate({ ...base, invitedBy: partner, codeOwner: creator }), {
      affiliateId: partner.ownerId,
      source: 'invite',
    });
  });
  test('attribution must come before the first payment', () => {
    assert.deepEqual(chooseAffiliate({ ...base, codeOwner: creator, paidBefore: true }), {
      rejected: 'already_paying',
    });
  });
  test('self-referral: same owner, partner, Stripe customer or email', () => {
    const self = { rejected: 'self' };
    assert.deepEqual(chooseAffiliate({ ...base, codeOwner: { ...creator, ownerId: customer } }), self);
    assert.deepEqual(chooseAffiliate({ ...base, codeOwner: creator, partners: [creator.ownerId] }), self);
    assert.deepEqual(chooseAffiliate({ ...base, codeOwner: { ...creator, stripeCustomerId: 'cus_customer' } }), self);
    assert.deepEqual(
      chooseAffiliate({ ...base, codeOwner: creator, customerEmails: ['Ash+alt@Creator.test', null] }),
      self,
    );
    assert.deepEqual(
      chooseAffiliate({ ...base, codeOwner: creator, customerEmails: [null, 'payouts@creator.test'] }),
      self,
    );
  });
  test('a self-referring invite falls through to an eligible code owner', () => {
    assert.deepEqual(
      chooseAffiliate({ ...base, invitedBy: partner, codeOwner: creator, partners: [partner.ownerId] }),
      {
        affiliateId: creator.ownerId,
        source: 'promotion_code',
      },
    );
  });
  test('emails normalise case and plus tags, and reject junk', () => {
    assert.equal(normaliseEmail(' Ash+yt@Creator.TEST '), 'ash@creator.test');
    assert.equal(normaliseEmail('not-an-email'), null);
    assert.equal(normaliseEmail(null), null);
  });
});

const invoice = (overrides: Partial<Stripe.Invoice> = {}) =>
  ({
    id: 'in_synthetic',
    status: 'paid',
    currency: 'gbp',
    amount_paid: 399,
    status_transitions: { paid_at: unix('2026-12-15T00:00:00Z') },
    lines: {
      data: [{ pricing: { price_details: { price: 'price_month' } }, period: { end: unix('2027-01-15T00:00:00Z') } }],
    },
    payments: { data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_synthetic' } }] },
    ...overrides,
  }) as unknown as Stripe.Invoice;

describe('commission calculation', () => {
  test('30% of the amount actually paid, rounded down to the penny', () => {
    assert.equal(commissionPence(399), 119);
    assert.equal(commissionPence(3499), 1049);
    assert.equal(commissionPence(7900), 2370);
    assert.equal(commissionPence(0), 0);
  });
  test('a paid subscription invoice earns, held for 30 days, keyed on the invoice', () => {
    const entry = invoiceEarning(invoice(), attribution, ['price_month']);
    assert.deepEqual(entry, {
      affiliate_owner_id: creator.ownerId,
      customer_owner_id: customer,
      kind: 'subscription',
      stripe_object_id: 'in_synthetic',
      stripe_payment_ref: 'pi_synthetic',
      amount_paid_pence: 399,
      rate_bps: 3000,
      commission_pence: 119,
      occurred_at: '2026-12-15T00:00:00.000Z',
      hold_until: '2027-01-14T00:00:00.000Z',
    });
  });
  test('a discounted invoice earns on what was paid; a free month, other currency or other price earns nothing', () => {
    assert.equal(invoiceEarning(invoice({ amount_paid: 199 }), attribution, ['price_month'])?.commission_pence, 59);
    assert.equal(invoiceEarning(invoice({ amount_paid: 0 }), attribution, ['price_month']), null);
    assert.equal(invoiceEarning(invoice({ currency: 'usd' }), attribution, ['price_month']), null);
    assert.equal(invoiceEarning(invoice(), attribution, ['price_other']), null);
    assert.equal(invoiceEarning(invoice({ status: 'open' }), attribution, ['price_month']), null);
  });
  test('subscription payments earn only in the first 12 months', () => {
    const at = (iso: string) =>
      invoice({ status_transitions: { paid_at: unix(iso) } as Stripe.Invoice.StatusTransitions });
    assert.ok(invoiceEarning(at('2027-11-14T23:59:59Z'), attribution, ['price_month']));
    assert.equal(invoiceEarning(at('2027-11-15T00:00:00Z'), attribution, ['price_month']), null);
  });
  test('a lifetime purchase earns 30%; a £0 creator-code redemption earns nothing', () => {
    const session = {
      id: 'cs_synthetic',
      payment_intent: 'pi_life',
      amount_total: 7900,
      created: unix('2026-11-20T00:00:00Z'),
    };
    assert.equal(lifetimeEarning(session, attribution)?.commission_pence, 2370);
    assert.equal(lifetimeEarning(session, attribution)?.stripe_object_id, 'cs_synthetic');
    assert.equal(lifetimeEarning({ ...session, amount_total: 0, payment_intent: null }, attribution), null);
  });
});

describe('refund and dispute reversal', () => {
  const charge = { id: 'ch_synthetic', payment_intent: 'pi_synthetic', amount: 399, amount_refunded: 0 };
  test('a partial or full refund leaves what is still paid', () => {
    assert.deepEqual(chargeStillPaid({ ...charge, amount_refunded: 100 }, []), {
      paymentRef: 'pi_synthetic',
      remainingPaid: 299,
    });
    assert.equal(chargeStillPaid({ ...charge, amount_refunded: 399 }, []).remainingPaid, 0);
    assert.equal(chargeStillPaid({ ...charge, payment_intent: null }, []).paymentRef, 'ch_synthetic');
  });
  test('a dispute holding the money takes everything back; won, prevented and inquiries do not', () => {
    for (const status of ['needs_response', 'under_review', 'lost', 'appeal_under_review'])
      assert.equal(chargeStillPaid(charge, ['won', status]).remainingPaid, 0, status);
    for (const status of ['won', 'prevented', 'warning_needs_response', 'warning_closed'])
      assert.equal(chargeStillPaid({ ...charge, amount_refunded: 99 }, [status]).remainingPaid, 300, status);
  });
  test('the earning key is the Stripe object, so a replayed invoice is the same row', () => {
    const a = invoiceEarning(invoice(), attribution, ['price_month']);
    assert.equal(a?.stripe_object_id, invoiceEarning(invoice(), attribution, ['price_month'])?.stripe_object_id);
  });
});

describe('earnings summary', () => {
  test('pending until the hold ends, then payable, then paid; refunds net out', () => {
    const now = Date.parse('2026-12-20T00:00:00Z');
    assert.deepEqual(
      summariseEarnings(
        [
          { commission_pence: 119, status: 'pending', hold_until: '2027-01-14T00:00:00Z' },
          { commission_pence: 2370, status: 'pending', hold_until: '2026-12-19T00:00:00Z' },
          { commission_pence: -2370, status: 'pending', hold_until: '2026-12-19T00:00:00Z' },
          { commission_pence: 119, status: 'paid', hold_until: '2026-11-01T00:00:00Z' },
        ],
        now,
      ),
      { pendingPence: 119, payablePence: 0, paidPence: 119 },
    );
  });
});
