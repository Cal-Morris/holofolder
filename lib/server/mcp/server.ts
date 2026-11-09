import {knownDeveloperError} from '@/lib/server/developer-access/request'
import type {DeveloperPrincipal} from '@/lib/developer-api/types'
import {auditDeveloperOperation} from '@/lib/server/developer-access/audit'
import {McpServer} from '@modelcontextprotocol/server'
import {DEVELOPER_OPERATIONS} from '@/lib/developer-api/operations'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
import {requireMcpContext} from '@/lib/server/developer-access/principal'
import {executeDeveloperOperation} from '@/lib/server/operations/developer-dispatch'
export function createHoloMcpServer(request:Request,requestId:string,principal:DeveloperPrincipal) {
 const server=new McpServer({name:'Holo Folder',version:'1.0.0'})
 for(const operation of DEVELOPER_OPERATIONS) {
  server.registerTool(operation.name,{description:operation.description,inputSchema:operation.schema,
   annotations:{readOnlyHint:!operation.write,destructiveHint:operation.destructive??(operation.write&&/^(?:update|save|delete|remove|cancel|disconnect|accept|reject)_/.test(operation.name)),idempotentHint:operation.idempotent??(!operation.write||operation.name==='create_binder'),openWorldHint:operation.name==='get_listings'||operation.name.startsWith('refresh_')||operation.name==='start_comparison_job'}},async input=>{
   try {
    const maxBytes=operation.maxBytes??(operation.name==='update_appearance'?131072:65536)
    if(Buffer.byteLength(JSON.stringify(input))>maxBytes)throw new DeveloperAccessError('body_too_large',`Tool arguments must be at most ${maxBytes/1024} KiB.`,413)
    const context=await requireMcpContext(request,operation.permissions,operation.write?'write':'read',requestId)
    const result=await executeDeveloperOperation(context,operation.name,input)
    auditDeveloperOperation(context,operation.name,'success')
    const output=result && typeof result==='object'&&!Array.isArray(result)?result as Record<string,unknown>:{data:result}
    return {content:[{type:'text' as const,text:JSON.stringify(output)}],structuredContent:output}
   }catch(error) {
    const safe=knownDeveloperError(error)
    const known=safe!==null
    auditDeveloperOperation({principal,requestId},operation.name,'failure',known?safe.code:'temporarily_unavailable')
    const output={error:{code:known?safe.code:'temporarily_unavailable',message:known?safe.message:'This operation is temporarily unavailable.',requestId}}
    return {isError:true,content:[{type:'text' as const,text:JSON.stringify(output)}],structuredContent:output}
   }
  })
 }
 return server
}
