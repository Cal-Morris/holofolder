import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readBillingCache, writeBillingCache } from '../lib/billing-cache'
import { resolveBillingAccess } from '../lib/billing'
const values = new Map<string,string>()
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string,value: string) => { values.set(key,value) } }
test('cached access cannot cross accounts or collection owners', () => {
  writeBillingCache(storage,'account',resolveBillingAccess('owner',{ perpetual: true, enforced: true }))
  assert.equal(readBillingCache(storage,'account','owner')?.source,'perpetual')
  assert.equal(readBillingCache(storage,'stranger','owner'),null)
  assert.equal(readBillingCache(storage,'account','another-owner'),null)
})
test('expired subscription cache becomes free', () => {
  writeBillingCache(storage,'account',resolveBillingAccess('owner',{ status:'active',paid_through:'2099-01-01',enforced:true }))
  assert.equal(readBillingCache(storage,'account','owner',Date.parse('2100-01-01'))?.tier,'free')
})
