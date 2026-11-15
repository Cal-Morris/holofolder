import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { billingAccessRow, resolveBillingAccess } from '../lib/billing';
import { readBillingCache } from '../lib/billing-cache';
import { INVITE_COOKIE_MAX_AGE, isInviteCode, readInviteCookie, signInviteCookie } from '../lib/referrals';

const SECRET = 'synthetic-test-secret';
const now = Date.parse('2026-11-14T12:00:00Z');
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('invite cookie', () => {
  test('round-trips the code and the server click time', () => {
    const value = signInviteCookie(SECRET, 'abcde23456', now - 1000);
    assert.deepEqual(readInviteCookie(SECRET, value, now), { code: 'abcde23456', clickedAt: iso(now - 1000) });
  });
  test('rejects tampering, a different secret, expiry, future clicks and junk', () => {
    const value = signInviteCookie(SECRET, 'abcde23456', now - 1000);
    const [code, at, sig] = value.split('.');
    // Backdating the click to before an existing account was created must fail the signature.
    assert.equal(readInviteCookie(SECRET, `${code}.${now - 365 * day}.${sig}`, now), null);
    assert.equal(readInviteCookie(SECRET, `zzzzzzzzzz.${at}.${sig}`, now), null);
    assert.equal(readInviteCookie('other-secret', value, now), null);
    assert.equal(
      readInviteCookie(SECRET, signInviteCookie(SECRET, 'abcde23456', now - INVITE_COOKIE_MAX_AGE * 1000 - 1), now),
      null,
    );
    assert.equal(readInviteCookie(SECRET, signInviteCookie(SECRET, 'abcde23456', now + 5 * 60_000), now), null);
    for (const junk of [undefined, '', 'abc', `${value}.extra`, `ABCDE23456.${at}.${sig}`])
      assert.equal(readInviteCookie(SECRET, junk, now), null);
  });
  test('codes are a random referral code or a username, in their database formats', () => {
    for (const good of ['abcde23456', 'ash', 'ash-ketchum', 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5'])
      assert.ok(isInviteCode(good), good);
    for (const bad of ['ABCDE23456', 'ab', '-ash', 'ash-', 'ash.ketchum', 'a'.repeat(31), 42])
      assert.ok(!isInviteCode(bad), String(bad));
  });
  test('a username survives the cookie round trip', () => {
    const value = signInviteCookie(SECRET, 'ash-ketchum', now - 1000);
    assert.equal(readInviteCookie(SECRET, value, now)?.code, 'ash-ketchum');
  });
});

describe('granted Premium time', () => {
  const base = { enforced: true, free_card_limit: 2_147_483_647, free_binder_limit: 1 };
  test('an active grant is paid access that lapses to free on its own', () => {
    const access = resolveBillingAccess('owner', { ...base, granted_until: iso(now + 10 * day) }, now);
    assert.equal(access.source, 'grant');
    assert.equal(access.tier, 'paid');
    assert.equal(access.binderLimit > 1, true);
    assert.equal(resolveBillingAccess('owner', { ...base, granted_until: iso(now - 1) }, now).source, 'free');
  });
  test('lifetime, subscription and trial take precedence over a grant', () => {
    const grant = { ...base, granted_until: iso(now + 30 * day) };
    assert.equal(resolveBillingAccess('o', { ...grant, perpetual: true }, now).source, 'perpetual');
    assert.equal(
      resolveBillingAccess('o', { ...grant, status: 'active', paid_through: iso(now + day) }, now).source,
      'subscription',
    );
    const trial = resolveBillingAccess('o', { ...grant, trial_ends_at: iso(now + day) }, now);
    assert.equal(trial.source, 'trial');
    assert.equal(trial.grantedUntil, iso(now + 30 * day));
    // The grant chain starts where the trial ends, so access continues with no gap.
    assert.equal(resolveBillingAccess('o', billingAccessRow(trial), now + 2 * day).source, 'grant');
  });
  test('the offline cache honours the grant expiry like the trial', () => {
    const access = resolveBillingAccess('owner', { ...base, granted_until: iso(now + day) }, now);
    const storage = { getItem: () => JSON.stringify({ accountId: 'acct', access }) };
    assert.equal(readBillingCache(storage, 'acct', 'owner', now)?.source, 'grant');
    assert.equal(readBillingCache(storage, 'acct', 'owner', now + 2 * day)?.source, 'free');
  });
  test('rows without the 133 fields (migration not applied) keep the old rules', () => {
    const access = resolveBillingAccess('owner', base, now);
    assert.equal(access.source, 'free');
    assert.equal(access.grantedUntil, null);
    assert.equal(access.referralPending, false);
  });
});
