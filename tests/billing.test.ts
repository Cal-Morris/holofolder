import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { savedCardWeight, countSavedCards, resolveBillingAccess, canGrowCollection } from '../lib/billing'

describe('billing access', () => {
  test('counts owned slots and individual wants, including legacy wishes', () => {
    assert.equal(savedCardWeight({ status: 'collected', wanted_cards: [{}, {}] }), 3)
    assert.equal(savedCardWeight({ status: 'wishlisted', wanted_cards: [{}, {}] }), 2)
    assert.equal(savedCardWeight({ status: 'wishlisted', wanted_cards: [] }), 1)
    assert.equal(countSavedCards(Array.from({ length: 11 }, () => ({ status: 'collected' }))), 11)
  })
  test('perpetual overrides every subscription state and expiry', () => {
    const access = resolveBillingAccess('owner', { enforced: true, perpetual: true, status: 'canceled', paid_through: '2000-01-01', saved_card_count: 1000 })
    assert.equal(access.source, 'perpetual')
    assert.equal(access.tier, 'paid')
    assert.equal(canGrowCollection(access, 1000, 1001), true)
  })
  test('only paid time grants subscription access, including failed renewal within paid time', () => {
    assert.equal(resolveBillingAccess('owner', { enforced: true, status: 'active' }).tier, 'free')
    assert.equal(resolveBillingAccess('owner', { enforced: true, status: 'active', paid_through: '2000-01-01' }).tier, 'free')
    assert.equal(resolveBillingAccess('owner', { enforced: true, status: 'past_due', paid_through: '2099-01-01' }).source, 'subscription')
    assert.equal(resolveBillingAccess('owner', { enforced: true, status: 'canceled', paid_through: '2099-01-01' }).tier, 'free')
  })
  test('allows the tenth card and non-growing edits above the limit', () => {
    const free = resolveBillingAccess('owner', { enforced: true })
    assert.equal(canGrowCollection(free, 9, 10), true)
    assert.equal(canGrowCollection(free, 10, 11), false)
    assert.equal(canGrowCollection(free, 100, 100), true)
    assert.equal(canGrowCollection(free, 100, 99), true)
  })
})

test('pending cards in another binder count toward the same offline allowance', async () => {
  const { pendingCardDelta } = await import('../lib/billing')
  assert.equal(pendingCardDelta([{ type:'upsert', base:null, item:{status:'collected',wanted_cards:[{}]} }]),2)
  assert.equal(pendingCardDelta([{ type:'upsert', base:{status:'collected'}, item:{status:'collected'} }]),0)
  assert.equal(pendingCardDelta([{ type:'delete', base:{status:'collected'} }]),-1)
})
