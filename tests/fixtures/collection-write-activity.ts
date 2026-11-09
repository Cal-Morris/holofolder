import assert from 'node:assert/strict'
import {NextRequest} from 'next/server'
async function main() {
 // Synthetic setup and edit transactions, module mocks remain isolated.
 // @ts-expect-error Bun module mocks are confined to subprocesses.
 const {mock}=await import('bun:test')
 mock.module('../../lib/supabase/server',()=>({createClient:async()=>({})}))
 mock.module('../../lib/supabase/session-user',()=>({getFirstPartyUser:async()=>({data:{user:{id:'synthetic-actor'}}})}))
 const {auditContextHeader}=await import('../../lib/server/audit-context')
 const ids:string[]=[]
 let failed=false
 mock.module('../../lib/server/operations/collection',()=>({saveCollectionItem:async()=>{
   ids.push(JSON.parse(auditContextHeader()!).operationId) // default collection creation
   ids.push(JSON.parse(auditContextHeader()!).operationId) // actual row save
   return Response.json({item:{pokemon_id:1}})
 },updateCollectionStatus:async()=>Response.json({}),deleteCollectionItem:async()=>Response.json({})}))
 mock.module('../../lib/supabase/admin',()=>({createAdminClient:()=>({from(table:string){assert.equal(table,'collection_activity');const q={select(){return q},in(key:string,values:string[]){assert.equal(key,'operation_id');assert.deepEqual(values,ids.slice(-2));assert.notEqual(values[0],values[1]);return q},eq(){return q},order(){return q},limit(){return q},maybeSingle:async()=>{if(failed)throw new Error('Unavailable');return {data:{id:'123'}}}};return q}})}))
 const {POST}=await import('../../app/api/collection/route')
 let response=await POST(new NextRequest('https://synthetic.test/app/api/collection',{method:'POST',body:'{}'}))
 assert.equal(response.status,200);assert.equal(response.headers.get('X-Activity-Event'),'123')
 assert.equal(auditContextHeader(),undefined)
 failed=true;response=await POST(new NextRequest('https://synthetic.test/app/api/collection',{method:'POST',body:'{}'}))
 assert.equal(response.status,200);assert.equal(response.headers.get('X-Activity-Event'),null)
}
void main()
