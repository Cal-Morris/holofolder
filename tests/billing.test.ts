import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBillingAccess, canCreateOwnerBinder } from '../lib/billing';

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
    assert.equal(canCreateOwnerBinder(trial, 1), true);
    const expired = resolveBillingAccess('owner', row, Date.parse(end));
    assert.equal(expired.tier, 'free');
    assert.equal(expired.savedCardCount, 150);
    assert.equal(expired.cardLimit, 100);
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
    assert.equal(access.cardLimit, null);
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
  test('uses the server allowance', () => {
    const free = resolveBillingAccess('owner', { enforced: true, free_card_limit: 100, free_binder_limit: 1 });
    assert.equal(free.cardLimit, 100);
    assert.equal(free.binderLimit, 1);
  });
  test('keeps legacy enforcement until server allowance fields exist', () => {
    const free = resolveBillingAccess('owner', { enforced: true });
    assert.equal(free.cardLimit, 10);
    assert.equal(free.binderLimit, 20);
  });
  test('rejects malformed allowances and caps the binder safety limit', () => {
    for (const value of [null, '100', 0, -1, 1.5, Infinity]) {
      const free = resolveBillingAccess('owner', { enforced: true, free_card_limit: value, free_binder_limit: value });
      assert.equal(free.cardLimit, 10);
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
