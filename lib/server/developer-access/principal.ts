import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseDeveloperKey } from './key-secret'
import { resolveBillingAccess } from '@/lib/billing'
import { DeveloperAccessError, developerEntitled, normalizePermissions, requirePermissions, type DeveloperPermission } from '@/lib/developer-api/permissions'
import type { OperationContext } from '@/lib/developer-api/types'
import { authenticateKey } from './keys'
import { requireDeveloperEntitlement } from './entitlement'
import { consumeDeveloperPreauth, developerPreauthBucket } from './limits'
import { bearerCredential } from './request'
export async function requireRestContext(request:Request, required:readonly DeveloperPermission[], kind:'read'|'write', requestId:string=crypto.randomUUID()):Promise<OperationContext> {
 const raw=bearerCredential(request)
 if(!raw) throw new DeveloperAccessError('invalid_api_key','Authenticate with an API key in the Authorization bearer header.',401)
 const parsed=parseDeveloperKey(raw)
 if(parsed) {
  const {data,error}=await createAdminClient().rpc('authenticate_developer_request',{
   key_id:parsed.id,presented_digest:createHash('sha256').update(parsed.secret).digest('hex'),
   required_permissions:[...required],request_kind:kind,preauth_bucket:developerPreauthBucket(request),
  })
  if(!error) {
   if(!data)throw new Error('Developer authorization unavailable')
   if(data.error==='rate_limited')throw new DeveloperAccessError('rate_limited','Request limit reached. Try again shortly.',429,Number(data.retry_after)||60)
   if(data.error==='invalid_api_key')throw new DeveloperAccessError('invalid_api_key','Provide a valid, unexpired API key.',401)
   if(data.error==='insufficient_permissions')throw new DeveloperAccessError('insufficient_permissions','This credential does not have permission for this operation.',403)
   if(data.error)throw new Error('Developer authorization unavailable')
   if(!developerEntitled(resolveBillingAccess(data.owner_user_id,data.billing_access)))throw new DeveloperAccessError('premium_required','API and MCP access require a Premium subscription or lifetime access.',402)
   if(typeof data.budget?.allowed!=='boolean')throw new Error('Request budget unavailable')
   if(!data.budget.allowed)throw new DeveloperAccessError('rate_limited','Request limit reached. Try again shortly.',429,Number(data.budget.retry_after)||60)
   const principal={actorId:data.actor_id,credentialId:data.credential_id,transport:'rest' as const,permissions:normalizePermissions(data.permissions)}
   requirePermissions(principal.permissions,required)
   return {principal,ownerUserId:data.owner_user_id,memberIds:data.member_ids,requestId}
  }
  if(!['PGRST202','42883'].includes(error.code))throw new Error('Developer authorization unavailable')
 }
 await consumeDeveloperPreauth(request)
 const principal=await authenticateKey(raw)
 requirePermissions(principal.permissions,required)
 const membership=await requireDeveloperEntitlement(principal.actorId,kind)
 return {principal,...membership,requestId}
}

export async function requireMcpContext(request:Request,required:readonly DeveloperPermission[],kind:'read'|'write',requestId:string=crypto.randomUUID()):Promise<OperationContext> {
 const raw=bearerCredential(request)
 if(!raw || raw.startsWith('hf_')) throw new DeveloperAccessError('invalid_oauth_token','Connect this MCP client through OAuth. API keys are only for the REST API.',401)
 const {authenticateMcpToken}=await import('./grants')
 const principal=await authenticateMcpToken(raw,request.headers.get('origin'))
 requirePermissions(principal.permissions,required)
 const membership=await requireDeveloperEntitlement(principal.actorId,kind)
 return {principal,...membership,requestId}
}
