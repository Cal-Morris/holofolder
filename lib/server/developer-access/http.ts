import type {OperationContext} from '@/lib/developer-api/types'
import {auditDeveloperOperation} from '@/lib/server/developer-access/audit'
import {matchRestOperation} from '@/lib/developer-api/operations'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
import {requireRestContext} from '@/lib/server/developer-access/principal'
import {DEVELOPER_HEADERS,developerErrorResponse,readDeveloperJson,knownDeveloperError,restResponse} from '@/lib/server/developer-access/request'
import {executeDeveloperOperation} from '@/lib/server/operations/developer-dispatch'
export async function handleRestRequest(request:Request,{params}:{params:Promise<{path:string[]}>}) {
 const started=performance.now(),requestId=crypto.randomUUID()
 let context:OperationContext|undefined,operationName:string|undefined
 try {
  const path='/'+(await params).path.join('/'),match=matchRestOperation(request.method,path)
  if(!match) throw new DeveloperAccessError('not_found','API operation not found.',404)
  operationName=match.operation.name
  context=await requireRestContext(request,match.operation.permissions,match.operation.write?'write':'read',requestId)
  const authenticated=performance.now()
  const url=new URL(request.url),query:Record<string,unknown>={}
  for(const [key,value] of url.searchParams) {
   if(key in query) throw new DeveloperAccessError('invalid_query','Do not repeat query parameters.',400)
   query[key]=['limit','pokemon','pokemonId'].includes(key)?Number(value):key==='confirm'?value==='true':value
  }
  const body=request.method==='GET'?{}:await readDeveloperJson(request,match.operation.maxBytes??(match.operation.name==='update_appearance'?131072:65536))
  const candidate:Record<string,unknown>={...query,...body,...match.params}
  if(match.operation.schema.shape.idempotencyKey) {
   const header=request.headers.get('idempotency-key')
   if(header && candidate.idempotencyKey && header!==candidate.idempotencyKey)throw new DeveloperAccessError('invalid_idempotency_key','Idempotency keys in the header and body must match.',400)
   candidate.idempotencyKey=header??candidate.idempotencyKey
  }
  if(typeof candidate.pokemonId==='string')candidate.pokemonId=Number(candidate.pokemonId)
  const input=match.operation.schema.safeParse(candidate)
  if(!input.success) throw new DeveloperAccessError('invalid_input',input.error.issues[0]?.message??'Invalid input.',400)
  const result=await executeDeveloperOperation(context,match.operation.name,input.data)
  auditDeveloperOperation(context,match.operation.name,'success')
  return restResponse(Response.json(result,{headers:{...DEVELOPER_HEADERS,'X-Request-Id':requestId,'Server-Timing':`auth;dur=${(authenticated-started).toFixed(1)}, operation;dur=${(performance.now()-authenticated).toFixed(1)}, total;dur=${(performance.now()-started).toFixed(1)}`}}))
 }catch(error){if(context&&operationName)auditDeveloperOperation(context,operationName,'failure',knownDeveloperError(error)?.code??'temporarily_unavailable');return restResponse(developerErrorResponse(error,requestId))}
}
