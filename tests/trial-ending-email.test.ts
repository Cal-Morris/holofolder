import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildTrialEndingEmail, selectTrialEmailRecipients, type TrialEmailCandidate } from '@/lib/trial-ending-email';

// Synthetic fixtures only.
const now = new Date('2026-11-14T10:00:00Z');
const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
const row = (overrides: Partial<TrialEmailCandidate> = {}): TrialEmailCandidate => ({
  owner_user_id: '00000000-0000-4000-8000-000000000001',
  email: 'collector@example.test',
  trial_ends_at: hoursFromNow(48),
  email_confirmed: true,
  partner_member: false,
  lifetime: false,
  paid_through: null,
  granted_until: null,
  already_emailed: false,
  ...overrides,
});
const selected = (overrides: Partial<TrialEmailCandidate>) => selectTrialEmailRecipients([row(overrides)], now).length;

describe('selectTrialEmailRecipients', () => {
  test('selects a free owner whose trial ends in 40 to 64 hours', () => {
    assert.deepEqual(selectTrialEmailRecipients([row()], now), [
      { ownerUserId: row().owner_user_id, email: 'collector@example.test', trialEndsAt: new Date(hoursFromNow(48)) },
    ]);
    assert.equal(selected({ trial_ends_at: hoursFromNow(40) }), 1);
    assert.equal(selected({ trial_ends_at: hoursFromNow(39.9) }), 0);
    assert.equal(selected({ trial_ends_at: hoursFromNow(64) }), 0);
  });

  test('skips anyone who keeps Premium or should not get it', () => {
    assert.equal(selected({ lifetime: true }), 0);
    assert.equal(selected({ paid_through: hoursFromNow(24 * 30) }), 0);
    assert.equal(selected({ granted_until: hoursFromNow(24 * 37) }), 0);
    assert.equal(selected({ partner_member: true }), 0);
    assert.equal(selected({ already_emailed: true }), 0);
    assert.equal(selected({ email_confirmed: false }), 0);
    assert.equal(selected({ email: null }), 0);
    assert.equal(selected({ email: '  ' }), 0);
  });

  test('still emails when paid time or a grant ends before the trial does', () => {
    assert.equal(selected({ paid_through: hoursFromNow(12) }), 1);
    assert.equal(selected({ granted_until: hoursFromNow(48) }), 1);
  });
});

describe('buildTrialEndingEmail', () => {
  test('states the end date, plans and invite reward in plain text', () => {
    const { subject, text } = buildTrialEndingEmail({
      trialEndsAt: new Date('2026-11-16T14:05:00Z'),
      appUrl: 'https://holofolder.com/app',
      lifetimeOffered: true,
    });
    assert.equal(subject, 'Your Holo Folder Premium trial ends on Monday 16 November');
    assert.match(text, /ends on Monday 16 November at 14:05 \(UK time\)/);
    assert.match(text, /£3\.99 a month, £34\.99 a year or £79\.00 once for lifetime access/);
    assert.match(text, /you both get a month of Premium free/);
    assert.doesNotMatch(text, /—|–/);
  });

  test('leaves lifetime out when it is not offered', () => {
    const { text } = buildTrialEndingEmail({
      trialEndsAt: new Date('2026-11-16T14:05:00Z'),
      appUrl: 'https://holofolder.com/app',
      lifetimeOffered: false,
    });
    assert.match(text, /£3\.99 a month or £34\.99 a year\./);
    assert.doesNotMatch(text, /lifetime/);
  });
});
