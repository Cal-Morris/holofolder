import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
import {authenticateMcpToken} from '@/lib/server/developer-access/grants'
import {requireDeveloperEntitlement} from '@/lib/server/developer-access/entitlement'
import {consumeDeveloperLimit,consumeDeveloperPreauth} from '@/lib/server/developer-access/limits'
import {bearerCredential,DEVELOPER_HEADERS,developerErrorResponse,readDeveloperJson} from '@/lib/server/developer-access/request'
import {createHoloMcpServer} from '@/lib/server/mcp/server'
import {MCP_METADATA_URL} from '@/lib/server/mcp/metadata'
export async function handleMcpRequest(request:Request) {
 const requestId=crypto.randomUUID()
 try {
  const token=bearerCredential(request)
  if(!token||token.startsWith('hf_')) throw new DeveloperAccessError('oauth_required','Connect through OAuth. API keys are only for REST.',401)
  await consumeDeveloperPreauth(request)
  const principal=await authenticateMcpToken(token,request.headers.get('origin'))
  await requireDeveloperEntitlement(principal.actorId)
  const body=request.method==='POST'?await readDeveloperJson(request,131072):undefined
  if(body?.method!=='tools/call') await consumeDeveloperLimit(principal.actorId,'read')
  const server=createHoloMcpServer(request,requestId,principal)
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true})
  try {
   await server.connect(transport)
   const response=await transport.handleRequest(request,{parsedBody:body})
   for(const [key,value] of Object.entries(DEVELOPER_HEADERS))response.headers.set(key,value)
   response.headers.set('X-Request-Id',requestId)
   response.headers.set('Access-Control-Allow-Origin','*')
   response.headers.set('Access-Control-Expose-Headers','WWW-Authenticate, MCP-Protocol-Version, X-Request-Id')
   return response
  }finally {await server.close()}
 }catch(error) {
  const response=developerErrorResponse(error,requestId)
  response.headers.set('Access-Control-Allow-Origin','*')
  response.headers.set('Access-Control-Expose-Headers','WWW-Authenticate, MCP-Protocol-Version, X-Request-Id')
  if(response.status===401)response.headers.set('WWW-Authenticate',`Bearer resource_metadata="${MCP_METADATA_URL}"`)
  return response
 }
}
export function mcpOptions() {
 return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID','Access-Control-Max-Age':'600'}})
}
