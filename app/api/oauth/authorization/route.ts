import {requireDeveloperSettingsUser} from '@/lib/server/developer-access/first-party'
import {requireDeveloperEntitlement} from '@/lib/server/developer-access/entitlement'
import {DEVELOPER_HEADERS,developerErrorResponse} from '@/lib/server/developer-access/request'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
export async function GET(request:Request) {
 const requestId=crypto.randomUUID()
 try {
  const {client}=await requireDeveloperSettingsUser(request)
  const id=new URL(request.url).searchParams.get('authorization_id')
  if(!id||id.length>200)throw new DeveloperAccessError('invalid_authorization','The authorization request is missing or invalid.',400)
  const {data,error}=await client.auth.oauth.getAuthorizationDetails(id)
  if(error||!data)throw new DeveloperAccessError('invalid_authorization','This authorization request expired or is invalid. Connect again from your MCP client.',400)
  if('redirect_url'in data)return Response.json({redirectUrl:data.redirect_url},{headers:DEVELOPER_HEADERS})
  let eligible=false
  try {await requireDeveloperEntitlement(data.user.id);eligible=true}catch(error){if(!(error instanceof DeveloperAccessError)||error.status!==402)throw error}
  return Response.json({authorizationId:data.authorization_id,client:{id:data.client.id,name:data.client.name},redirectUri:data.redirect_uri,scope:data.scope,eligible},{headers:DEVELOPER_HEADERS})
 }catch(error){return developerErrorResponse(error,requestId)}
}
