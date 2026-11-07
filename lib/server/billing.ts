import { createAdminClient } from '@/lib/supabase/admin'
import { BillingAccessError, resolveBillingAccess } from '@/lib/billing'

export async function getBillingAccess(ownerUserId: string) {
  const { data, error } = await createAdminClient().rpc('get_billing_access', { owner_id: ownerUserId })
  if (error) {
    if (['PGRST202', '42883'].includes(error.code)) return resolveBillingAccess(ownerUserId)
    throw new Error('Account access could not be checked. Try again shortly.')
  }
  if (!data) throw new Error('Account access could not be checked.')
  return resolveBillingAccess(ownerUserId, data)
}
export async function requirePaidAccess(ownerUserId: string) {
  const access = await getBillingAccess(ownerUserId)
  if (access.enforced && access.tier !== 'paid') throw new BillingAccessError()
  return access
}
export function billingErrorResponse(error: unknown) {
  if (error instanceof Error && "status" in error && error.status === 403) return Response.json({ error: "Request origin is not allowed" }, { status: 403, headers: { "Cache-Control": "private, no-store" } })
  if (error instanceof BillingAccessError) return Response.json({ error: error.message, code: error.code }, { status: 402, headers: { 'Cache-Control': 'private, no-store' } })
  return Response.json({ error: 'Billing is temporarily unavailable. Try again shortly.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
}
