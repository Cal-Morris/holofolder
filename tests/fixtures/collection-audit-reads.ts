import assert from "node:assert/strict"
import type {OperationContext} from "../../lib/developer-api/types"

async function main() {
 process.env.NEXT_PUBLIC_SUPABASE_URL="https://synthetic.supabase.test"
 process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-key"
 const {readCollectionAudit,isAuditId}=await import("../../lib/server/operations/audit")
 const {matchRestOperation}=await import("../../lib/developer-api/operations")
 assert.equal(matchRestOperation("GET","/collection/audit")?.operation.name,"list_collection_audit")
 assert.equal(matchRestOperation("GET","/collection/audit/123")?.operation.name,"get_collection_audit")
 const context:OperationContext={principal:{actorId:"synthetic-partner",credentialId:"synthetic-grant",transport:"rest",permissions:["collection:read"]},ownerUserId:"synthetic-owner",memberIds:[],requestId:"synthetic-request"}
 const rows=Array.from({length:1105},(_,i)=>({id:String(1105-i),actor_kind:"unknown",changes:[]}))
 let missing=false
 globalThis.fetch=async(input)=>{
  const url=new URL(String(input))
  assert.equal(url.searchParams.get("owner_user_id"),"eq.synthetic-owner")
  assert.equal(url.searchParams.get("order"),"id.desc")
  const columns=url.searchParams.get("select")!
  assert.ok(!columns.includes("recovery_state"));assert.ok(!columns.includes("command_evidence"))
  if(missing)return Response.json({code:"42703",message:"missing column"},{status:400})
  let found=rows
  const id=url.searchParams.get("id")
  if(id?.startsWith("lt."))found=found.filter(row=>Number(row.id)<Number(id.slice(3)))
  if(id?.startsWith("eq."))found=found.filter(row=>row.id===id.slice(3))
  return Response.json(found.slice(0,Number(url.searchParams.get("limit"))))
 }
 let cursor:string|null=null
 const seen:string[]=[]
 do {
  const page=await readCollectionAudit(context,{limit:100,...(cursor?{cursor}:{})}) as {data:Array<{id:string}>;nextCursor:string|null}
  seen.push(...page.data.map(row=>row.id));cursor=page.nextCursor
 }while(cursor)
 assert.equal(seen.length,1105);assert.equal(new Set(seen).size,1105)
 const first=await readCollectionAudit(context,{limit:100,collectionId:"synthetic-binder"}) as {nextCursor:string}
 await assert.rejects(readCollectionAudit(context,{limit:100,collectionId:"other-binder",cursor:first.nextCursor}),/cursor/)
 assert.equal((await readCollectionAudit(context,{id:"1105"},true) as {id:string}).id,"1105")
 await assert.rejects(readCollectionAudit(context,{id:"99999"},true),/not found/)
 missing=true
 await assert.rejects(readCollectionAudit(context,{}),/temporarily unavailable/)
 for(const id of ["0","-1","1 or true","9223372036854775808"])assert.equal(isAuditId(id),false)
 assert.equal(isAuditId("9223372036854775807"),true)
}
main().catch(error=>{console.error(error);process.exitCode=1})
