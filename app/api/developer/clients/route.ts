import {revokeMcpConnection} from '@/lib/server/developer-access/oauth-requests'
import {needsOAuthRevocation} from '@/lib/developer-api/oauth'
import {createAdminClient} from '@/lib/supabase/admin'
import {requireDeveloperSettingsUser} from '@/lib/server/developer-access/first-party'
import {DEVELOPER_HEADERS,developerErrorResponse,readDeveloperJson} from '@/lib/server/developer-access/request'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
export async function GET(request:Request) {
 const requestId=crypto.randomUUID()
 try {
  const {user}=await requireDeveloperSettingsUser(request)
  const {data,error}=await createAdminClient().from('developer_oauth_grants').select('client_id,client_name,permissions,created_at,revoked_at,auth_revoked_at').eq('actor_id',user.id).or('revoked_at.is.null,auth_revoked_at.is.null').order('created_at',{ascending:false}).limit(100)
  if(error)throw new Error('Client lookup unavailable')
  return Response.json({clients:(data??[]).map(row=>({...row,revocationPending:needsOAuthRevocation(row)}))},{headers:DEVELOPER_HEADERS})
 }catch(error){return developerErrorResponse(error,requestId)}
}
export async function DELETE(request:Request) {
 const requestId=crypto.randomUUID()
 try {
  const {client,user}=await requireDeveloperSettingsUser(request,true),body=await readDeveloperJson(request)
  if(typeof body.clientId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.clientId))throw new DeveloperAccessError('invalid_client','Choose a valid client.',400)
  await revokeMcpConnection(client,user.id,body.clientId)
  return Response.json({revoked:true},{headers:DEVELOPER_HEADERS})
 }catch(error){return developerErrorResponse(error,requestId)}
}
