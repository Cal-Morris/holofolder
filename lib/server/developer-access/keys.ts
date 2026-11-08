import { createAdminClient } from '@/lib/supabase/admin'
import { DeveloperAccessError, normalizePermissions } from '@/lib/developer-api/permissions'
import type { DeveloperPrincipal } from '@/lib/developer-api/types'
import { parseDeveloperKey, verifyDeveloperKey } from './key-secret'
export async function authenticateKey(raw: string): Promise<DeveloperPrincipal> {
 const parsed=parseDeveloperKey(raw)
 const invalid=()=>new DeveloperAccessError('invalid_api_key','Provide a valid, unexpired API key.',401)
 if(!parsed) throw invalid()
 const admin=createAdminClient()
 const {data,error}=await admin.from('developer_api_keys').select('id,actor_id,secret_digest,permissions,expires_at,revoked_at,last_used_at').eq('id',parsed.id).maybeSingle()
 if(error) throw new Error('Credential lookup failed')
 if(!data || data.revoked_at || Date.parse(data.expires_at)<=Date.now() || !Number.isFinite(Date.parse(data.expires_at)) || !verifyDeveloperKey(raw,data.secret_digest)) throw invalid()
 if(!data.last_used_at || Date.parse(data.last_used_at)<Date.now()-3600000) {
  const {error:updateError}=await admin.from('developer_api_keys').update({last_used_at:new Date().toISOString()}).eq('id',data.id).is('revoked_at',null)
  if(updateError) throw new Error('Credential usage update failed')
 }
 return {actorId:data.actor_id,credentialId:data.id,transport:'rest',permissions:normalizePermissions(data.permissions)}
}
