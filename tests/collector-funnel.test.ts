import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAttribution, readClientFunnelEvent, funnelReport } from '../lib/collector-funnel';

test('only approved non-identifying acquisition slugs survive', () => {
  assert.deepEqual(sanitizeAttribution({ source: 'YouTube', medium: 'social', campaign: 'launch' }), {
    source: 'youtube',
    medium: 'social',
    campaign: 'launch',
  });
  for (const source of [
    'cal@example.com',
    'https://private.test/token',
    '123456789',
    'a'.repeat(100),
    'private-person',
  ])
    assert.equal(sanitizeAttribution({ source }).source, null);
  assert.equal(sanitizeAttribution(null).source, null);
});
test('clients cannot forge trusted milestones or arbitrary telemetry fields', () => {
  assert.equal(readClientFunnelEvent({ event: 'app_open', attribution: { source: 'reddit' } }).event, 'app_open');
  for (const body of [
    { event: 'first_paid' },
    { event: 'first_save' },
    { event: 'app_open', ownerId: 'other' },
    { event: 'upgrade_viewed', url: 'private' },
  ])
    assert.throws(() => readClientFunnelEvent(body));
});
test('ordered owner cohorts distinguish later-day return, partners and renewal eligibility', () => {
  const account = (id: string) => ({
    account_id: id,
    first_seen_at: '2026-11-01T00:00:00Z',
    owner_seen_at: '2026-11-01T00:00:00Z',
    source: 'reddit',
    medium: null,
    campaign: null,
  });
  const event = (name: string, at: string, actor = 'one', extra = {}) => ({
    owner_id: 'one',
    actor_id: actor,
    name,
    occurred_at: at,
    event_key: name + at,
    origin: null,
    subscription_id: null,
    period_start: null,
    period_end: null,
    ...extra,
  });
  const events = [
    event('first_save', '2026-11-01T01:00:00Z'),
    event('activated', '2026-11-01T02:00:00Z'),
    event('app_open', '2026-11-01T03:00:00Z'),
    event('app_open', '2026-11-02T01:00:00Z', 'partner'),
    event('upgrade_viewed', '2026-11-02T02:00:00Z'),
    event('checkout_created', '2026-11-02T03:00:00Z'),
    event('first_paid', '2026-11-02T04:00:00Z', 'one', {
      subscription_id: 'synthetic-sub',
      period_start: '2026-11-02T04:00:00Z',
      period_end: '2026-12-02T04:00:00Z',
    }),
  ];
  const report = funnelReport([account('one'), account('two')], events, '2026-11-01', '2026-11-08');
  assert.equal(report.groups[0].owners, 2);
  assert.equal(report.groups[0].activated, 1);
  assert.equal(report.groups[0].retentionEligible, 1);
  assert.equal(report.groups[0].returned, 0);
  assert.equal(report.groups[0].paid, 1);
  assert.equal(report.groups[0].renewalEligible, 0);
  assert.equal(
    funnelReport([account('one')], [...events, event('app_open', '2026-11-03T00:00:00Z')], '2026-11-01', '2026-11-08')
      .groups[0].returned,
    1,
  );
  const midnight = funnelReport([account('one')], events, '2026-11-01', '2026-11-02').groups[0];
  assert.equal(midnight.retentionEligible, 0);
  assert.equal(midnight.laterDayReturnRate, null);
});

test('renewal counts require an eligible paid period and a matching verified cycle', () => {
  const account = {
    account_id: 'owner',
    first_seen_at: '2026-10-01T00:00:00Z',
    owner_seen_at: '2026-10-01T00:00:00Z',
    source: null,
    medium: null,
    campaign: null,
  };
  const first = {
    owner_id: 'owner',
    actor_id: 'owner',
    name: 'first_paid',
    occurred_at: '2026-10-02T00:00:00Z',
    event_key: 'first_paid',
    origin: null,
    subscription_id: 'synthetic-sub',
    period_start: '2026-10-02T00:00:00Z',
    period_end: '2026-11-02T00:00:00Z',
  };
  const renewal = {
    ...first,
    name: 'renewed',
    occurred_at: '2026-11-02T00:00:00Z',
    event_key: 'renewal:synthetic',
    period_start: first.period_end,
    period_end: '2026-12-02T00:00:00Z',
  };
  const report = funnelReport([account], [first, renewal], '2026-10-01', '2026-11-08').groups[0];
  assert.equal(report.renewalEligible, 1);
  assert.equal(report.renewed, 1);
  assert.equal(report.renewalRate, 1);
  assert.equal(
    funnelReport([account], [first, { ...renewal, subscription_id: 'other' }], '2026-10-01', '2026-11-08').groups[0]
      .renewed,
    0,
  );
});
