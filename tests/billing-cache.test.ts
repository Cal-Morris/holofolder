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
  writeBillingCache(storage,'account',resolveBillingAccess('owner',{ status:'active',paid_through:'2099-01-01',enforced:true,free_card_limit:100,free_binder_limit:1 }))
  const expired=readBillingCache(storage,'account','owner',Date.parse('2100-01-01'))
  assert.equal(expired?.tier,'free')
  assert.equal(expired?.cardLimit,100)
  assert.equal(expired?.binderLimit,1)
})
test('legacy cached access remains conservative before its next server refresh', () => {
  storage.setItem('holofolder_billing_v1',JSON.stringify({accountId:'account',access:{ownerUserId:'owner',source:'free',enforced:true,savedCardCount:9}}))
  assert.equal(readBillingCache(storage,'account','owner')?.cardLimit,10)
})
