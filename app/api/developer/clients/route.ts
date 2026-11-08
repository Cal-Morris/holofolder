import {createAdminClient} from '@/lib/supabase/admin'
import {requireDeveloperSettingsUser} from '@/lib/server/developer-access/first-party'
import {DEVELOPER_HEADERS,developerErrorResponse,readDeveloperJson} from '@/lib/server/developer-access/request'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
export async function GET(request:Request) {
 const requestId=crypto.randomUUID()
 try {
  const {user}=await requireDeveloperSettingsUser(request)
  const {data,error}=await createAdminClient().from('developer_oauth_grants').select('client_id,client_name,permissions,created_at,revoked_at').eq('actor_id',user.id).is('revoked_at',null).order('created_at',{ascending:false}).limit(100)
  if(error)throw new Error('Client lookup unavailable')
  return Response.json({clients:data},{headers:DEVELOPER_HEADERS})
 }catch(error){return developerErrorResponse(error,requestId)}
}
export async function DELETE(request:Request) {
 const requestId=crypto.randomUUID()
 try {
  const {client,user}=await requireDeveloperSettingsUser(request,true),body=await readDeveloperJson(request)
  if(typeof body.clientId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.clientId))throw new DeveloperAccessError('invalid_client','Choose a valid client.',400)
  // Revoke our grant first so issued JWTs are denied even if the Auth request fails.
  const {error}=await createAdminClient().from('developer_oauth_grants').update({revoked_at:new Date().toISOString()}).eq('actor_id',user.id).eq('client_id',body.clientId)
  if(error)throw new Error('Revocation unavailable')
  const {error:authError}=await client.auth.oauth.revokeGrant({clientId:body.clientId})
  if(authError)throw new DeveloperAccessError('revocation_incomplete','Data access is revoked. Retry to finish revoking the OAuth session.',503)
  return Response.json({revoked:true},{headers:DEVELOPER_HEADERS})
 }catch(error){return developerErrorResponse(error,requestId)}
}
