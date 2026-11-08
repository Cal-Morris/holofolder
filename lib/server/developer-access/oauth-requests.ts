import type {SupabaseClient} from '@supabase/supabase-js'
import {createAdminClient} from '@/lib/supabase/admin'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
import {requireDeveloperEntitlement} from './entitlement'
export async function revokeMcpConnection(client:SupabaseClient,actorId:string,clientId:string) {
 const admin=createAdminClient()
 const {error}=await admin.from('developer_oauth_grants').update({revoked_at:new Date().toISOString(),auth_revoked_at:null}).eq('actor_id',actorId).eq('client_id',clientId)
 if(error)throw new Error('Revocation unavailable')
 const {error:authError}=await client.auth.oauth.revokeGrant({clientId})
 if(authError)throw new DeveloperAccessError('revocation_incomplete','Data access is revoked. Retry disconnection in Settings to finish removing the OAuth session.',503)
 const finished=await admin.from('developer_oauth_grants').update({auth_revoked_at:new Date().toISOString()}).eq('actor_id',actorId).eq('client_id',clientId).not('revoked_at','is',null)
 if(finished.error)throw new DeveloperAccessError('revocation_incomplete','Data access is revoked. Retry disconnection in Settings to finish removing the OAuth session.',503)
}
export async function requireActiveMcpAuthorization(client:SupabaseClient,actorId:string,authorizationId:string) {
 const {data,error}=await createAdminClient().rpc('read_developer_oauth_request',{authorization_id_input:authorizationId,actor:actorId})
 if(error)throw new Error('Authorization lookup unavailable')
 if(!data?.client_id)throw new DeveloperAccessError('invalid_authorization','This authorization request expired. Connect again from your MCP client.',400)
 if(!data.grant_active) {
  await revokeMcpConnection(client,actorId,data.client_id)
  throw new DeveloperAccessError('reconnect_required','This connection was revoked. Start a new connection from your MCP client to review access again.',409)
 }
 await requireDeveloperEntitlement(actorId)
}
