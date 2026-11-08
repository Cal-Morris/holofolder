import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { BillingContext, type BillingState } from '../hooks/use-billing'
import { BillingSettings } from '../components/billing-settings'
import { resolveBillingAccess } from '../lib/billing'
function render(source: 'free'|'perpetual'|'subscription',canManage=true,hasBillingAccount=false) {
 const state: BillingState={ access:resolveBillingAccess('owner',{enforced:true,perpetual:source==='perpetual',status:source==='subscription'?'active':'none',paid_through:'2099-01-01',saved_card_count:10,free_card_limit:100,free_binder_limit:1}),canManage,hasBillingAccount,loading:false,error:null,busy:false,premium:source!=='free',refresh:async()=>{},upgrade:()=>{},checkout:async()=>{},portal:async()=>{} }
 return renderToStaticMarkup(<BillingContext.Provider value={state}><BillingSettings signedIn onSignIn={()=>{}} /></BillingContext.Provider>)
}
test('lifetime plan shows permanent access without purchase or billing controls',()=>{
 const html=render('perpetual')
 assert.match(html,/Lifetime access/)
 assert.doesNotMatch(html,/£3.99|£34.99|Manage billing/)
})
test('free plan shows both approved prices and the total card allowance',()=>{
 const html=render('free')
 assert.match(html,/£3.99 \/ month/)
 assert.match(html,/£34.99 \/ year, save £12.89/)
 assert.match(html,/10 of 100 free entries/)
 assert.match(html,/1 free binder/)
})
test('only the billing owner gets subscription management controls',()=>{
 assert.match(render('subscription'),/Manage billing/)
 assert.doesNotMatch(render('subscription',false),/>Manage billing</)
 assert.match(render('subscription',false),/Your collection owner manages this plan/)
})

test('a subscriber later granted lifetime access can still stop their existing billing',()=>{
 assert.match(render('perpetual',true,true),/Manage my existing billing/)
})
