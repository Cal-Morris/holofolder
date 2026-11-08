import { DeveloperAccessError, developerEntitled } from '@/lib/developer-api/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCollectionMembership } from '@/lib/server/collection-owner'
import { consumeDeveloperLimit } from './limits'
import { resolveBillingAccess } from '@/lib/billing'

export async function requireDeveloperEntitlement(actorId: string, kind?: 'read'|'write') {
  const result=await createAdminClient().rpc('resolve_developer_access',{actor:actorId,request_kind:kind??null})
  if(!result.error) {
    const row=result.data
    if(!row?.billing_access)throw new Error('Developer entitlement is temporarily unavailable')
    if(!developerEntitled(resolveBillingAccess(row.owner_user_id,row.billing_access)))throw new DeveloperAccessError('premium_required','API and MCP access require a Premium subscription or lifetime access.',402)
    if(kind) {
      if(typeof row.budget?.allowed!=='boolean')throw new Error('Request budget unavailable')
      if(!row.budget.allowed)throw new DeveloperAccessError('rate_limited','Request limit reached. Try again shortly.',429,Number(row.budget.retry_after)||60)
    }
    return {ownerUserId:row.owner_user_id as string,memberIds:row.member_ids as string[],partnershipId:row.partnership_id as string|null}
  }
  if(!['PGRST202','42883'].includes(result.error.code))throw new Error('Developer entitlement is temporarily unavailable')
  const membership = await resolveCollectionMembership(createAdminClient(), actorId)
  const { data, error } = await createAdminClient().rpc('get_billing_access', { owner_id: membership.ownerUserId })
  if (error || !data) throw new Error('Developer entitlement is temporarily unavailable')
  const access = resolveBillingAccess(membership.ownerUserId, data)
  if (!developerEntitled(access)) throw new DeveloperAccessError('premium_required', 'API and MCP access require a Premium subscription or lifetime access.', 402)
  if(kind)await consumeDeveloperLimit(actorId,kind)
  return membership
}
