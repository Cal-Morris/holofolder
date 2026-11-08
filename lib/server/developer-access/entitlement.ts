import { DeveloperAccessError, developerEntitled } from '@/lib/developer-api/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCollectionMembership } from '@/lib/server/collection-owner'
import { resolveBillingAccess } from '@/lib/billing'

export async function requireDeveloperEntitlement(actorId: string) {
  const membership = await resolveCollectionMembership(createAdminClient(), actorId)
  const { data, error } = await createAdminClient().rpc('get_billing_access', { owner_id: membership.ownerUserId })
  if (error || !data) throw new Error('Developer entitlement is temporarily unavailable')
  const access = resolveBillingAccess(membership.ownerUserId, data)
  if (!developerEntitled(access)) throw new DeveloperAccessError('premium_required', 'API and MCP access require a Premium subscription or lifetime access.', 402)
  return membership
}
