import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  savedCardWeight,
  countSavedCards,
  resolveBillingAccess,
  canGrowCollection,
  canCreateOwnerBinder,
} from '../lib/billing';

describe('billing access', () => {
  test('a signup trial unlocks all premium limits until its exact expiry', () => {
    const end = '2026-11-15T12:00:00.000Z';
    const row = {
      enforced: true,
      trial_ends_at: end,
      free_card_limit: 100,
      free_binder_limit: 1,
      saved_card_count: 150,
    };
    const trial = resolveBillingAccess('owner', row, Date.parse(end) - 1);
    assert.equal(trial.source, 'trial');
    assert.equal(trial.tier, 'paid');
    assert.equal(trial.cardLimit, null);
    assert.equal(canGrowCollection(trial, 150, 151), true);
    assert.equal(canCreateOwnerBinder(trial, 1), true);
    const expired = resolveBillingAccess('owner', row, Date.parse(end));
    assert.equal(expired.tier, 'free');
    assert.equal(expired.savedCardCount, 150);
    assert.equal(canGrowCollection(expired, 150, 150), true);
    assert.equal(canGrowCollection(expired, 150, 151), false);
    assert.equal(canCreateOwnerBinder(expired, 1), false);
  });
  test('trial access requires a valid expiry and never overrides paid or lifetime access', () => {
    for (const end of [undefined, null, '', 'invalid', 123]) {
      assert.equal(resolveBillingAccess('owner', { trial_ends_at: end }).source, 'free');
    }
    const trial = { trial_ends_at: '2099-01-01' };
    assert.equal(resolveBillingAccess('owner', { ...trial, perpetual: true }).source, 'perpetual');
    assert.equal(
      resolveBillingAccess('owner', { ...trial, status: 'active', paid_through: '2099-01-01' }).source,
      'subscription',
    );
    assert.equal(resolveBillingAccess('owner', { ...trial, status: 'canceled' }).source, 'trial');
  });
  test('counts owned slots and individual wants, including legacy wishes', () => {
    assert.equal(savedCardWeight({ status: 'collected', wanted_cards: [{}, {}] }), 3);
    assert.equal(savedCardWeight({ status: 'wishlisted', wanted_cards: [{}, {}] }), 2);
    assert.equal(savedCardWeight({ status: 'wishlisted', wanted_cards: [] }), 1);
    assert.equal(countSavedCards(Array.from({ length: 11 }, () => ({ status: 'collected' }))), 11);
  });
  test('perpetual overrides every subscription state and expiry', () => {
    const access = resolveBillingAccess('owner', {
      enforced: true,
      perpetual: true,
      status: 'canceled',
      paid_through: '2000-01-01',
      saved_card_count: 1000,
    });
    assert.equal(access.source, 'perpetual');
    assert.equal(access.tier, 'paid');
    assert.equal(canGrowCollection(access, 1000, 1001), true);
  });
  test('only paid time grants subscription access, including failed renewal within paid time', () => {
    assert.equal(resolveBillingAccess('owner', { enforced: true, status: 'active' }).tier, 'free');
    assert.equal(
      resolveBillingAccess('owner', { enforced: true, status: 'active', paid_through: '2000-01-01' }).tier,
      'free',
    );
    assert.equal(
      resolveBillingAccess('owner', { enforced: true, status: 'past_due', paid_through: '2099-01-01' }).source,
      'subscription',
    );
    assert.equal(
      resolveBillingAccess('owner', { enforced: true, status: 'canceled', paid_through: '2099-01-01' }).tier,
      'free',
    );
  });
  test('uses the server allowance and allows non-growing edits above it', () => {
    const free = resolveBillingAccess('owner', { enforced: true, free_card_limit: 100, free_binder_limit: 1 });
    assert.equal(canGrowCollection(free, 99, 100), true);
    assert.equal(canGrowCollection(free, 100, 101), false);
    assert.equal(canGrowCollection(free, 150, 150), true);
    assert.equal(canGrowCollection(free, 150, 149), true);
    assert.equal(free.cardLimit, 100);
    assert.equal(free.binderLimit, 1);
  });
  test('keeps legacy enforcement until server allowance fields exist', () => {
    const free = resolveBillingAccess('owner', { enforced: true });
    assert.equal(canGrowCollection(free, 9, 10), true);
    assert.equal(canGrowCollection(free, 10, 11), false);
    assert.equal(free.binderLimit, 20);
  });
  test('rejects malformed allowances and caps the binder safety limit', () => {
    for (const value of [null, '100', 0, -1, 1.5, Infinity]) {
      const free = resolveBillingAccess('owner', { enforced: true, free_card_limit: value, free_binder_limit: value });
      assert.equal(canGrowCollection(free, 10, 11), false);
      assert.equal(free.binderLimit, 20);
    }
    assert.equal(resolveBillingAccess('owner', { enforced: true, free_binder_limit: 500 }).binderLimit, 20);
  });
  test('only paid or lifetime access permits a second binder and all tiers stop at twenty', () => {
    const row = { enforced: true, free_card_limit: 100, free_binder_limit: 1 };
    const free = resolveBillingAccess('owner', row);
    assert.equal(canCreateOwnerBinder(free, 0), true);
    assert.equal(canCreateOwnerBinder(free, 1), false);
    const expired = resolveBillingAccess('owner', { ...row, status: 'active', paid_through: '2000-01-01' });
    assert.equal(canCreateOwnerBinder(expired, 1), false);
    for (const access of [
      resolveBillingAccess('owner', { ...row, perpetual: true }),
      resolveBillingAccess('owner', { ...row, status: 'active', paid_through: '2099-01-01' }),
    ]) {
      assert.equal(canCreateOwnerBinder(access, 1), true);
      assert.equal(canCreateOwnerBinder(access, 20), false);
    }
  });
});

test('pending cards in another binder count toward the same offline allowance', async () => {
  const { pendingCardDelta } = await import('../lib/billing');
  assert.equal(
    pendingCardDelta([{ type: 'upsert', base: null, item: { status: 'collected', wanted_cards: [{}] } }]),
    2,
  );
  assert.equal(pendingCardDelta([{ type: 'upsert', base: { status: 'collected' }, item: { status: 'collected' } }]), 0);
  assert.equal(pendingCardDelta([{ type: 'delete', base: { status: 'collected' } }]), -1);
});
