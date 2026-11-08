import { createAdminClient } from '@/lib/supabase/admin'
import { createDeveloperKey } from '@/lib/server/developer-access/key-secret'
import { requireDeveloperSettingsUser } from '@/lib/server/developer-access/first-party'
import { requireDeveloperEntitlement } from '@/lib/server/developer-access/entitlement'
import { consumeDeveloperLimit } from '@/lib/server/developer-access/limits'
import { DEVELOPER_HEADERS, developerErrorResponse, readDeveloperJson } from '@/lib/server/developer-access/request'
import { normalizeKeyInput } from '@/lib/developer-api/keys'
import { DeveloperAccessError, developerEntitled } from '@/lib/developer-api/permissions'
import { getBillingAccess } from '@/lib/server/billing'
import { resolveCollectionOwnerUserId } from '@/lib/server/collection-owner'
const metadata='id,name,permissions,created_at,expires_at,revoked_at,last_used_at'
export async function GET(request:Request) {
 const requestId=crypto.randomUUID()
 try {
  const {user}=await requireDeveloperSettingsUser(request)
  const admin=createAdminClient()
  const [{data,error},owner]=await Promise.all([admin.from('developer_api_keys').select(metadata).eq('actor_id',user.id).is('revoked_at',null).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(100),resolveCollectionOwnerUserId(admin,user.id)])
  if(error) throw new Error('Key listing unavailable')
  return Response.json({keys:data,canCreate:developerEntitled(await getBillingAccess(owner))},{headers:DEVELOPER_HEADERS})
 } catch(error) {return developerErrorResponse(error,requestId)}
}
export async function POST(request:Request) {
 const requestId=crypto.randomUUID()
 try {
  const {user}=await requireDeveloperSettingsUser(request,true)
  await requireDeveloperEntitlement(user.id)
  await consumeDeveloperLimit(user.id,'write')
  const input=normalizeKeyInput(await readDeveloperJson(request))
  const key=createDeveloperKey(),admin=createAdminClient()
  const {error}=await admin.rpc('create_developer_api_key',{key_id:key.id,actor:user.id,key_name:input.name,digest:key.digest,granted_permissions:input.permissions,expiry_days:input.expiryDays})
  if(error?.message.includes('key_limit_reached')) throw new DeveloperAccessError('key_limit_reached','Revoke an existing key before creating another. You can have ten active keys.',409)
  if(error) throw new Error('Key creation unavailable')
  const {data,error:readError}=await admin.from('developer_api_keys').select(metadata).eq('id',key.id).eq('actor_id',user.id).single()
  if(readError) throw new Error('Key creation unavailable')
  return Response.json({key:key.key,metadata:data},{status:201,headers:DEVELOPER_HEADERS})
 } catch(error) {return developerErrorResponse(error,requestId)}
}
export async function DELETE(request:Request) {
 const requestId=crypto.randomUUID()
 try {
  const {user}=await requireDeveloperSettingsUser(request,true)
  const {id}=await readDeveloperJson(request)
  if(typeof id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new DeveloperAccessError('invalid_key','Choose a valid key.',400)
  const {error}=await createAdminClient().from('developer_api_keys').update({revoked_at:new Date().toISOString()}).eq('id',id).eq('actor_id',user.id).is('revoked_at',null)
  if(error) throw new Error('Revocation unavailable')
  return Response.json({revoked:true},{headers:DEVELOPER_HEADERS})
 } catch(error) {return developerErrorResponse(error,requestId)}
}
