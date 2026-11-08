import 'server-only'
import Stripe from 'stripe'
import { appPath } from '@/lib/app-path'
import { recognizedBillingPriceIds } from '@/lib/billing-subscription'

let client: Stripe | undefined
export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured')
  if (/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY) && process.env.VERCEL_ENV !== 'production') throw new Error('Use Stripe test mode outside production')
  return client ??= new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 20000 })
}
export function billingPriceIds() {
  const month = process.env.STRIPE_MONTHLY_PRICE_ID
  const year = process.env.STRIPE_YEARLY_PRICE_ID
  if (!month || !year) throw new Error('Subscription prices are not configured')
  return { month, year }
}
export function billingRecognizedPriceIds() {
  return recognizedBillingPriceIds(billingPriceIds(), process.env.STRIPE_LEGACY_PRICE_IDS)
}
export function billingReturnUrl() {
  const site = process.env.NEXT_PUBLIC_SITE_URL
  if (!site) throw new Error('Set NEXT_PUBLIC_SITE_URL for billing return URLs')
  const url = new URL(appPath('/'), site)
  url.search = 'billing=return'
  return url.toString()
}
