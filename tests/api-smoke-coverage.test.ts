import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { DEVELOPER_OPERATIONS } from '@/lib/developer-api/operations'
import { apiSmokeExitCode, summarizeApiSmokeCoverage, summarizeApiPerformance, type ApiPerformanceSample } from '@/lib/developer-api/performance-checks'
import { stagedSmokeInputs, validateStagedSmokeInputs } from '../scripts/api-smoke-staged'
import { assertSmokeHttpResponse } from '../scripts/api-smoke-assertions'

const inputs=stagedSmokeInputs('00830000-0000-4000-8000-000000000011','synthetic-test')
const denied={error:{code:'native_operations_staged',message:'Native storage operations are not enabled. Complete developer reads and rollout acceptance under #379 are still required.',requestId:'synthetic-request'}}
const samples:ApiPerformanceSample[]=DEVELOPER_OPERATIONS.map(op=>({operation:op.name,phase:'first',
 status:op.admission==='staged'?503:op.name==='start_comparison_job'?403:200,
 expectedStatus:op.admission==='staged'?503:op.name==='start_comparison_job'?403:200,
 scenario:op.admission==='staged'?'native-staged':'default',assertionsPassed:true,
 clientMs:100,serverMs:op.admission==='staged'?null:10,authMs:null,operationMs:null,bytes:1}))

test('all 15 staged denial inputs use current strict schemas, including canonical insertAssign',()=>{
 const operations=validateStagedSmokeInputs(inputs)
 assert.equal(operations.length,15)
 assert.equal(operations.filter(op=>op.method==='POST'&&op.name!=='preview_storage_preset').length,8)
 for(const op of operations) {
  assert.equal(op.schema.safeParse({...inputs[op.name],forgedOwner:'synthetic'}).success,false)
  assertSmokeHttpResponse(op.name,503,denied,inputs[op.name],503,'native-staged')
 }
 const dropped={...inputs};delete dropped.execute_inventory_commands
 assert.throws(()=>validateStagedSmokeInputs(dropped),/exactly cover/)
 assert.throws(()=>validateStagedSmokeInputs({...inputs,unexpected_native:{}}),/exactly cover/)
 assert.throws(()=>validateStagedSmokeInputs(inputs,[...DEVELOPER_OPERATIONS,{...operations[0],name:'new_native_operation'}]),/exactly cover/)
 assert.throws(()=>validateStagedSmokeInputs({...inputs,execute_inventory_commands:{}}))
 assert.throws(()=>validateStagedSmokeInputs(inputs,DEVELOPER_OPERATIONS.map(op=>op.name==='execute_inventory_commands'?{...op,admission:undefined}:op)),/exactly cover/)
 assert.throws(()=>assertSmokeHttpResponse('missing_operation',200,{}, {},200,'default'),/Missing response assertion/)
})

test('native success, auth/schema failures and malformed denials cannot masquerade as staging',()=>{
 for(const name of Object.keys(inputs)) {
  for(const status of [200,401,400,409,500])assert.throws(()=>assertSmokeHttpResponse(name,status,denied,inputs[name],503,'native-staged'))
  for(const body of [null,{}, {error:{}}, {error:{...denied.error,code:'invalid_input'}},
   {error:{...denied.error,message:''}}, {error:{...denied.error,requestId:''}},
   {error:{...denied.error,extra:true}}, {...denied,data:[]}, {error:{code:'native_operations_staged',message:denied.error.message}}]) {
   assert.throws(()=>assertSmokeHttpResponse(name,503,body,inputs[name],503,'native-staged'))
  }
  assert.throws(()=>assertSmokeHttpResponse(name,200,{},inputs[name],200,'default'),/denial-only/)
 }
})

test('complete admitted and denied coverage passes, with native execution and latency unverified',()=>{
 const coverage=summarizeApiSmokeCoverage(samples)
 assert.equal(coverage.filter(row=>row.successVerified).length,56)
 assert.equal(coverage.filter(row=>row.stagedDenialVerified).length,15)
 assert.equal(coverage.filter(row=>row.coverage==='uncovered').length,0)
 assert.equal(apiSmokeExitCode(samples,[],{users:true,artwork:[]}),0)
 for(const op of validateStagedSmokeInputs(inputs)) {
  const row=summarizeApiPerformance(samples).find(row=>row.operation===op.name)!
  assert.equal(row.verified,false);assert.equal(row.targetMet,null);assert.equal(row.medianMs,null);assert.equal(row.serverMedianMs,null)
 }
 const timedDenials=samples.map(sample=>sample.scenario==='native-staged'?{...sample,serverMs:99999}:sample)
 assert.equal(apiSmokeExitCode(timedDenials,[],{users:true,artwork:[]},true),0,'denial time is excluded from performance targets')
 assert.equal(apiSmokeExitCode(samples.map(sample=>sample.operation==='list_cards'?{...sample,serverMs:31}:sample),[],{users:true,artwork:[]},true),1)
})

test('dropped samples, missing assertions, unexpected responses and cleanup keep failure exits',()=>{
 for(const name of ['list_cards',...Object.keys(inputs)]) {
  assert.equal(apiSmokeExitCode(samples.filter(sample=>sample.operation!==name),[],{users:true,artwork:[]}),1)
  const changes=name==='list_cards'?[{assertionsPassed:false},{assertionsPassed:undefined},{status:401},{status:400}]
   :[{assertionsPassed:false},{assertionsPassed:undefined},{status:200},{status:401},{status:400},{scenario:'default'}]
  for(const change of changes) {
   const changed=samples.map(sample=>sample.operation===name?{...sample,...change}:sample)
   assert.equal(apiSmokeExitCode(changed,[],{users:true,artwork:[]}),1,name+JSON.stringify(change))
  }
 }
 assert.equal(apiSmokeExitCode(samples,[],{users:false,artwork:[]}),1)
 assert.equal(apiSmokeExitCode(samples,['cleanup failed'],{users:true,artwork:[]}),1)
 assert.equal(apiSmokeExitCode(samples,[],{users:true,artwork:['synthetic-owner/synthetic-artwork']}),2)
 assert.equal(apiSmokeExitCode(samples,['functional failure'],{users:true,artwork:['synthetic-owner/synthetic-artwork']}),1)
 assert.equal(apiSmokeExitCode(samples.map(sample=>sample.operation==='list_cards'?{...sample,serverMs:null}:sample),[],{users:true,artwork:[]}),1)
})

test('all denial fixtures pass real REST auth/route/dispatcher and MCP HTTP/SDK gates with zero executor calls',()=>{
 execFileSync(process.execPath,[new URL('./fixtures/api-smoke-staged.ts',import.meta.url).pathname],{stdio:'pipe'})
})
