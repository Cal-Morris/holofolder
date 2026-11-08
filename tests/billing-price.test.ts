import { test } from 'node:test'
import assert from 'node:assert/strict'
import type Stripe from 'stripe'
import { BILLING_PRICES, BILLING_ANNUAL_SAVING } from '../lib/billing'
import { assertCheckoutPrice, canReuseCheckout, recognizedBillingPriceIds } from '../lib/billing-subscription'
const price = { active:true,type:'recurring',currency:'gbp',unit_amount:399,recurring:{interval:'month',interval_count:1,usage_type:'licensed'},billing_scheme:'per_unit',transform_quantity:null,metadata:{app:'holofolder'},product:{active:true,metadata:{app:'holofolder'}} } as unknown as Stripe.Price
const session = { status:'open',mode:'subscription',url:'https://checkout.stripe.com/synthetic',metadata:{app:'holofolder',owner_user_id:'owner',interval:'month'},client_reference_id:'owner' } as unknown as Stripe.Checkout.Session
const lines = { has_more:false,data:[{quantity:1,price:{id:'price_new'}}] } as unknown as Stripe.ApiList<Stripe.LineItem>
test('approved prices and saving agree, and wrong Checkout products/amounts fail closed',()=>{
 assert.deepEqual(BILLING_PRICES,{month:399,year:3499});assert.equal(BILLING_ANNUAL_SAVING,1289)
 assert.doesNotThrow(()=>assertCheckoutPrice(price,'month'))
 for(const patch of [{unit_amount:299},{currency:'usd'},{active:false},{product:{active:true,metadata:{app:'unrelated'}}},{recurring:{interval:'year',interval_count:1,usage_type:'licensed'}}]) assert.throws(()=>assertCheckoutPrice({...price,...patch} as Stripe.Price,'month'))
})
test('legacy paid prices are recognized independently of new-sale prices',()=>{
 assert.deepEqual(recognizedBillingPriceIds({month:'price_new_month',year:'price_new_year'},'price_old_month, price_old_year'),['price_new_month','price_new_year','price_old_month','price_old_year'])
 assert.throws(()=>recognizedBillingPriceIds({month:'wrong',year:'price_year'}))
})
test('same interval is insufficient to reuse a Checkout, the actual owner and single line must match',()=>{
 assert.equal(canReuseCheckout(session,'owner','month','price_new',lines),true)
 assert.equal(canReuseCheckout(session,'owner','month','price_old',lines),false)
 assert.equal(canReuseCheckout(session,'another-owner','month','price_new',lines),false)
 assert.equal(canReuseCheckout(session,'owner','month','price_new',{...lines,has_more:true}),false)
 assert.equal(canReuseCheckout(session,'owner','month','price_new',{...lines,data:[...lines.data,...lines.data]}),false)
})
