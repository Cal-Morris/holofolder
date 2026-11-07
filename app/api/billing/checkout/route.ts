import { billingErrorResponse } from '@/lib/server/billing'
import { billingUser, billingHeaders } from '@/lib/server/billing-request'
import { startCheckout } from '@/lib/server/billing-subscriptions'
import { resolveCollectionOwnerUserId } from '@/lib/server/collection-owner'
import { createAdminClient } from '@/lib/supabase/admin'
export async function POST(request: Request) {
  try {
    const user = await billingUser(request,true)
    if (!user) return Response.json({ error: 'Sign in to subscribe.' }, { status: 401, headers: billingHeaders })
    if (await resolveCollectionOwnerUserId(createAdminClient(),user.id) !== user.id) return Response.json({ error: 'Your collection owner manages billing.' }, { status: 403, headers: billingHeaders })
    const body = await request.json().catch(() => null)
    if (!body || !['month','year'].includes(body.interval)) return Response.json({ error: 'Choose monthly or yearly billing.' }, { status: 400, headers: billingHeaders })
    return Response.json({ url: await startCheckout(user.id,user.email,body.interval) }, { headers: billingHeaders })
  } catch(error) { return billingErrorResponse(error) }
}
