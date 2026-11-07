import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUsername, normalizeDisplayName, accountDisplayName, notificationFirstName } from '../lib/account-identity'

describe('account identity', () => {
  test('normalizes unique URL usernames without accepting path characters', () => {
    assert.equal(normalizeUsername(' CaL-Morris '), 'cal-morris')
    for (const value of ['', 'ab', '-cal', 'cal-', 'cal_morris', 'cal/name', '@cal', 'a'.repeat(31), null, 12]) assert.equal(normalizeUsername(value), null)
    assert.equal(normalizeUsername('a'.repeat(30)), 'a'.repeat(30))
  })
  test('normalizes human names and rejects controls or oversized values', () => {
    assert.equal(normalizeDisplayName('  Cal   Morris  '), 'Cal Morris')
    assert.equal(normalizeDisplayName('Élodie'), 'Élodie')
    for (const value of ['', ' ', 'Cal\nMorris', 'x'.repeat(61), null, {}]) assert.equal(normalizeDisplayName(value), null)
  })
  test('reads the Supabase display name before provider metadata', () => {
    assert.equal(accountDisplayName({ display_name: 'Cal Morris', name: 'Old name' }), 'Cal Morris')
    assert.equal(accountDisplayName({ display_name: {}, name: 'Cal' }), 'Cal')
    assert.equal(accountDisplayName({ full_name: 'Élodie Martin' }), 'Élodie Martin')
  })
  test('uses the first name for notifications without leaking email or username', () => {
    assert.equal(notificationFirstName({ display_name: 'Cal Morris' }), 'Cal')
    assert.equal(notificationFirstName({ name: 'Mary-Jane Watson' }), 'Mary-Jane')
    assert.equal(notificationFirstName({ full_name: 'Élodie Martin' }), 'Élodie')
    assert.equal(notificationFirstName({ name: 'cal@example.com', username: 'cal' }), 'Your partner')
    assert.equal(notificationFirstName({}), 'Your partner')
    assert.equal(notificationFirstName({ display_name: 'Your partner' }), 'Your partner')
  })
})
