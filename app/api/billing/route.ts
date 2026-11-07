import { getBillingAccess, billingErrorResponse } from '@/lib/server/billing'
import { resolveCollectionOwnerUserId } from '@/lib/server/collection-owner'
import { createAdminClient } from '@/lib/supabase/admin'
import { billingUser, billingHeaders } from '@/lib/server/billing-request'
import { reconcileBilling } from '@/lib/server/billing-subscriptions'
export async function GET(request: Request) {
  try {
    const user = await billingUser(request)
    if (!user) return Response.json({ error: 'Sign in to manage your plan.' }, { status: 401, headers: billingHeaders })
    const ownerId = await resolveCollectionOwnerUserId(createAdminClient(), user.id)
    const access = await getBillingAccess(ownerId)
    const { data: ownBilling, error: accountError } = await createAdminClient().from("billing_accounts").select("stripe_customer_id").eq("owner_user_id", user.id).maybeSingle()
    if (accountError && !["PGRST205", "42P01"].includes(accountError.code)) throw accountError
    return Response.json({ access, canManage: ownerId === user.id, hasBillingAccount: Boolean(ownBilling?.stripe_customer_id) }, { headers: billingHeaders })
  } catch (error) { return billingErrorResponse(error) }
}
export async function POST(request: Request) {
  try {
    const user = await billingUser(request,true)
    if (!user) return Response.json({ error: 'Sign in to manage billing.' }, { status: 401, headers: billingHeaders })
    const access = await getBillingAccess(user.id)
    if (access.source !== 'perpetual') await reconcileBilling(user.id)
    return GET(request)
  } catch(error) { return billingErrorResponse(error) }
}
