// Defaults to read-only. --apply creates only Holo Folder resources on Syncaura.
import Stripe from 'stripe'
import { writeFile } from 'node:fs/promises'
import { BILLING_PRICES } from '../lib/billing'

async function main() {
  const apply = process.argv.includes('--apply')
  if (apply && !process.env.STRIPE_CONFIG_OUTPUT) throw new Error('Set STRIPE_CONFIG_OUTPUT to a new private output file before applying')
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')
  const account = await stripe.accounts.retrieve('acct_1AHHDjGnHtZtNtvx')
  if (account.id !== 'acct_1AHHDjGnHtZtNtvx') throw new Error('Expected the connected Syncaura account; no resources changed')
  const products = await stripe.products.list({ limit:100 })
  let product = products.data.find(p => p.metadata.app === 'holofolder' && p.active)
  console.log(JSON.stringify({ account:account.id, apply, product:product?.id ?? 'missing' }))
  if (!product && apply) product = await stripe.products.create({ name:'Holo Folder Premium', description:'Unlimited Pokémon cards, binder sharing, partner mode and sold price comparisons.', metadata:{ app:'holofolder' } },{idempotencyKey:'holofolder-premium-v1'})
  const config: Record<string,string> = {}
  for (const interval of ['month','year'] as const) {
    const lookup_key = `holofolder_gbp_${interval}_v1`
    let price = (await stripe.prices.list({ lookup_keys:[lookup_key],active:true,limit:10 })).data[0]
    if (!price && apply && product) price = await stripe.prices.create({ product:product.id, currency:'gbp',unit_amount:BILLING_PRICES[interval],recurring:{interval},lookup_key,metadata:{app:'holofolder'} },{idempotencyKey:lookup_key})
    if (price && (price.product !== product?.id || price.currency !== 'gbp' || price.unit_amount !== BILLING_PRICES[interval] || price.recurring?.interval !== interval || price.recurring.interval_count !== 1)) throw new Error('Existing Holo Folder price differs from the approved configuration')
    config[interval === 'month' ? 'STRIPE_MONTHLY_PRICE_ID' : 'STRIPE_YEARLY_PRICE_ID'] = price?.id ?? 'missing'
  }
  let portal = (await stripe.billingPortal.configurations.list({ limit:100 })).data.find(p=>p.metadata?.app==='holofolder' && p.active)
  if (!portal && apply) portal = await stripe.billingPortal.configurations.create({ metadata:{app:'holofolder'},business_profile:{headline:'Manage your Holo Folder subscription'},features:{customer_update:{enabled:true,allowed_updates:['email']},payment_method_update:{enabled:true},invoice_history:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end'}} })
  config.STRIPE_PORTAL_CONFIGURATION_ID = portal?.id ?? 'missing'
  const url = 'https://app.holofolder.com/app/api/billing/webhook'
  let webhook = (await stripe.webhookEndpoints.list({limit:100})).data.find(w=>w.url===url && w.metadata.app==='holofolder' && w.status==='enabled')
  if (!webhook && apply) {
    const created = await stripe.webhookEndpoints.create({ url,metadata:{app:'holofolder'},api_version:Stripe.API_VERSION,enabled_events:['invoice.paid','invoice.payment_failed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','checkout.session.completed'] })
    webhook = created
    const secretFile = process.env.STRIPE_CONFIG_OUTPUT
    if (!secretFile) throw new Error('Set STRIPE_CONFIG_OUTPUT to save the new webhook secret securely')
    await writeFile(secretFile,JSON.stringify({...config,STRIPE_WEBHOOK_SECRET:created.secret}),{mode:0o600,flag:'wx'})
    console.log('New webhook secret saved to the protected output file')
  }
  console.log(JSON.stringify({...config,webhook:webhook?.id ?? 'missing'}))
}
main().catch(error=>{ console.error(error instanceof Error ? error.message : 'Stripe configuration failed');process.exitCode=1 })
