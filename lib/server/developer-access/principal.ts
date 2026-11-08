import { DeveloperAccessError, requirePermissions, type DeveloperPermission } from '@/lib/developer-api/permissions'
import type { OperationContext } from '@/lib/developer-api/types'
import { authenticateKey } from './keys'
import { requireDeveloperEntitlement } from './entitlement'
import { consumeDeveloperLimit, consumeDeveloperPreauth } from './limits'
import { bearerCredential } from './request'
export async function requireRestContext(request:Request, required:readonly DeveloperPermission[], kind:'read'|'write', requestId:string=crypto.randomUUID()):Promise<OperationContext> {
 const raw=bearerCredential(request)
 if(!raw) throw new DeveloperAccessError('invalid_api_key','Authenticate with an API key in the Authorization bearer header.',401)
 await consumeDeveloperPreauth(request)
 const principal=await authenticateKey(raw)
 requirePermissions(principal.permissions,required)
 const membership=await requireDeveloperEntitlement(principal.actorId)
 await consumeDeveloperLimit(principal.actorId,kind)
 return {principal,...membership,requestId}
}

export async function requireMcpContext(request:Request,required:readonly DeveloperPermission[],kind:'read'|'write',requestId:string=crypto.randomUUID()):Promise<OperationContext> {
 const raw=bearerCredential(request)
 if(!raw || raw.startsWith('hf_')) throw new DeveloperAccessError('invalid_oauth_token','Connect this MCP client through OAuth. API keys are only for the REST API.',401)
 const {authenticateMcpToken}=await import('./grants')
 const principal=await authenticateMcpToken(raw,request.headers.get('origin'))
 requirePermissions(principal.permissions,required)
 const membership=await requireDeveloperEntitlement(principal.actorId)
 await consumeDeveloperLimit(principal.actorId,kind)
 return {principal,...membership,requestId}
}
