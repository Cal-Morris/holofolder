import { DeveloperAccessError, developerEntitled } from '@/lib/developer-api/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCollectionMembership } from '@/lib/server/collection-owner'
import { getBillingAccess } from '@/lib/server/billing'

export async function requireDeveloperEntitlement(actorId: string) {
  const membership = await resolveCollectionMembership(createAdminClient(), actorId)
  const access = await getBillingAccess(membership.ownerUserId)
  if (!developerEntitled(access)) throw new DeveloperAccessError('premium_required', 'API and MCP access require a Premium subscription or lifetime access.', 402)
  return membership
}
