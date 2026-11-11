import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REFRESH_INTERVAL, normalizeRefreshInterval } from '../lib/price-refresh-interval';

test('accepts minute, hour and day durations inside the allowed window', () => {
  assert.equal(normalizeRefreshInterval('15m'), '15m');
  assert.equal(normalizeRefreshInterval('90m'), '90m');
  assert.equal(normalizeRefreshInterval(' 3H '), '3h');
  assert.equal(normalizeRefreshInterval('1d'), '1d');
  assert.equal(normalizeRefreshInterval('24h'), '24h');
});

test('falls back to the default for missing or malformed intervals', () => {
  for (const value of [undefined, null, '', 'soon', '3 hours', '1.5h', '-3h', 3, '10s', '500ms']) {
    assert.equal(normalizeRefreshInterval(value), DEFAULT_REFRESH_INTERVAL, String(value));
  }
});

test('rejects intervals that would hammer providers or stall the workflow', () => {
  assert.equal(normalizeRefreshInterval('5m'), DEFAULT_REFRESH_INTERVAL);
  assert.equal(normalizeRefreshInterval('2d'), DEFAULT_REFRESH_INTERVAL);
  assert.equal(normalizeRefreshInterval('25h'), DEFAULT_REFRESH_INTERVAL);
});
