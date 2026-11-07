import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { resolveBillingAccess } from '../../lib/billing'

async function run() {
  // Synthetic customer/subscription/invoice objects. All Stripe and database I/O stays in this process.
  process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic'
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly'
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_synthetic'
  const account: Record<string,unknown> = { owner_user_id:'synthetic-owner',stripe_customer_id:'cus_synthetic',stripe_subscription_id:null,status:'none',paid_through:null }
  const receipts=new Set<string>()
  let locked=false,perpetual=false,reconciliations=0
  let status='active', paid=true, app='holofolder'
  let checkoutCreates=0
  const sessions: Array<Record<string,unknown>>=[]
  const fakeStripe={
    subscriptions:{ async *list() { reconciliations++;yield { id:'sub_synthetic',created:1,status,metadata:{app},items:{data:[{price:{id:'price_monthly'},quantity:1}]} } } },
    invoices:{ async *list() { if(paid) yield {status:'paid',lines:{data:[{pricing:{price_details:{price:'price_monthly'}},period:{end:2000000000}}]}} } },
    checkout:{sessions:{ async *list(){yield* sessions},async expire(id:string){const s=sessions.find(s=>s.id===id);if(s)s.status='expired'},async create(input:Record<string,unknown>){checkoutCreates++;const s={id:'cs_synthetic',url:'https://checkout.stripe.com/c/pay/synthetic',metadata:input.metadata,status:'open'};sessions.push(s);return s} } },
  }
  const admin={
    async rpc(name:string,args:Record<string,unknown>){
      if(name==='claim_billing_lock'){if(locked)return {data:false,error:null};locked=true;account.lock_token=args.token;return {data:true,error:null}}
      if(name==='commit_billing_state'){assert.equal(args.token,account.lock_token);account.status=args.subscription_status;account.paid_through=args.paid_until;account.stripe_subscription_id=args.subscription_id;if(args.event)receipts.add(String(args.event));locked=false;return {data:true,error:null}}
      throw new Error('Unexpected RPC')
    },
    from(table:string){
      let id=''
      const q={select(){return q},eq(_key:string,value:unknown){id=String(value);return q},update(_values:unknown){return q},async single(){return {data:account,error:null}},async maybeSingle(){return {data:table==='billing_events' ? receipts.has(id)?{event_id:id}:null : account,error:null}},then(resolve:(value:unknown)=>unknown){locked=false;return Promise.resolve({error:null}).then(resolve)}}
      return q
    },
  }
  // @ts-expect-error Bun mocks run only in this isolated test subprocess.
  const {mock}=await import('bun:test')
  mock.module('server-only',()=>({}))
  mock.module('../../lib/supabase/admin',()=>({createAdminClient:()=>admin}))
  const signatureStripe=new Stripe('sk_test_synthetic')
  mock.module('../../lib/server/stripe',()=>({getStripe:()=>({...fakeStripe,webhooks:signatureStripe.webhooks}),billingPriceIds:()=>({month:'price_monthly',year:'price_yearly'}),billingReturnUrl:()=> 'https://holofolder.com/app?billing=return'}))
  mock.module('../../lib/server/billing',()=>({getBillingAccess:async()=>resolveBillingAccess('synthetic-owner',{perpetual,enforced:true,status:account.status,paid_through:account.paid_through})}))
  const service=await import('../../lib/server/billing-subscriptions')
  const event=(id:string,type='invoice.paid')=>({id,type,livemode:false,data:{object:{customer:'cus_synthetic'}}}) as Stripe.Event
  await service.handleBillingEvent(event('evt_paid'))
  assert.equal(account.status,'active')
  assert.equal(account.paid_through,'2033-05-18T03:33:20.000Z')
  const calls=reconciliations
  await service.handleBillingEvent(event('evt_paid'))
  assert.equal(reconciliations,calls,'duplicate delivery does no external work')
  // An old event arriving after cancellation reconciles current Stripe state, not its stale snapshot.
  status='canceled'
  await service.handleBillingEvent(event('evt_late_paid'))
  assert.equal(account.status,'canceled')
  assert.equal(account.paid_through,null)
  status='active';paid=false
  await service.handleBillingEvent(event('evt_initial_unpaid','customer.subscription.created'))
  assert.equal(account.paid_through,null,'active status without a paid invoice grants no time')
  status='past_due';paid=true
  await service.handleBillingEvent(event('evt_renewal_failed','invoice.payment_failed'))
  assert.equal(account.paid_through,'2033-05-18T03:33:20.000Z','failed renewal preserves the prior paid invoice period')
  app='syncaura'
  await service.handleBillingEvent(event('evt_other_app'))
  assert.equal(account.paid_through,null,'unrelated subscriptions never grant Holo Folder access')
  app='holofolder';status='canceled'
  perpetual=true
  await assert.rejects(service.startCheckout('synthetic-owner',undefined,'month'),/lifetime access/)
  assert.equal(checkoutCreates,0)
  perpetual=false
  await service.startCheckout('synthetic-owner',undefined,'month')
  await service.startCheckout('synthetic-owner',undefined,'month')
  assert.equal(checkoutCreates,1,'repeat checkout reuses the open session')
  status='active'
  await assert.rejects(service.startCheckout('synthetic-owner',undefined,'month'),/already have a subscription/)
  const {POST}=await import('../../app/api/billing/webhook/route')
  const body=JSON.stringify(event('evt_signed'))
  assert.equal((await POST(new Request('https://synthetic.test/app/api/billing/webhook',{method:'POST',body}))).status,400)
  assert.equal((await POST(new Request('https://synthetic.test/app/api/billing/webhook',{method:'POST',headers:{'stripe-signature':'bad'},body}))).status,400)
  const signature=await signatureStripe.webhooks.generateTestHeaderStringAsync({payload:body,secret:'whsec_synthetic'})
  assert.equal((await POST(new Request('https://synthetic.test/app/api/billing/webhook',{method:'POST',headers:{'stripe-signature':signature},body}))).status,200)
  assert.ok(receipts.has('evt_signed'))
  const wrong=JSON.stringify({...event('evt_wrong_mode'),livemode:true})
  const wrongSignature=await signatureStripe.webhooks.generateTestHeaderStringAsync({payload:wrong,secret:'whsec_synthetic'})
  assert.equal((await POST(new Request('https://synthetic.test/app/api/billing/webhook',{method:'POST',headers:{'stripe-signature':wrongSignature},body:wrong}))).status,503)
  assert.equal(receipts.has('evt_wrong_mode'),false)
}
run().catch(error=>{console.error(error);process.exitCode=1})
