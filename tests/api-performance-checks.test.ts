import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEVELOPER_OPERATIONS} from '@/lib/developer-api/operations'
import {readServerTiming,summarizeApiPerformance,type ApiPerformanceSample} from '@/lib/developer-api/performance-checks'

test('performance coverage cannot pass unmeasured operations, failures or missing server timings',()=>{
 const empty=summarizeApiPerformance([])
 assert.equal(empty.length,DEVELOPER_OPERATIONS.length)
 assert.ok(empty.every(row=>!row.verified&&row.medianMs===null&&row.targetMet===null))
 const sample:ApiPerformanceSample={operation:'list_cards',phase:'first',status:200,clientMs:900,serverMs:400,authMs:50,operationMs:350,bytes:100}
 const rows=summarizeApiPerformance([sample,{...sample,phase:'repeat',clientMs:200,serverMs:75},{...sample,phase:'repeat',clientMs:100,serverMs:25}])
 const cards=rows.find(row=>row.operation==='list_cards')!
 assert.equal(cards.firstMs,900);assert.equal(cards.medianMs,150);assert.equal(cards.serverMedianMs,50);assert.equal(cards.targetMet,false);assert.equal(cards.verified,true)
 assert.equal(summarizeApiPerformance([{...sample,status:503}]).find(row=>row.operation==='list_cards')?.verified,false)
 assert.equal(summarizeApiPerformance([{...sample,serverMs:null}]).find(row=>row.operation==='list_cards')?.verified,false)
})
test('server timing parsing handles missing and malformed measurements without inventing zeroes',()=>{
 assert.equal(readServerTiming('auth;dur=12.5, operation;dur=3, total;dur=15.5','total'),15.5)
 for(const value of [null,'total;dur=NaN','total;dur=-1','other;dur=1','total;dur=1.2.3'])assert.equal(readServerTiming(value,'total'),null)
})

test('the smoke suite has response assertions for every registered operation',async()=>{
 const {API_SMOKE_ASSERTIONS,assertSmokeResponse}=await import('../scripts/api-smoke-assertions')
 assert.deepEqual(Object.keys(API_SMOKE_ASSERTIONS).sort(),DEVELOPER_OPERATIONS.map(op=>op.name).sort())
 assert.throws(()=>assertSmokeResponse('list_cards',{data:[],nextCursor:123},{}))
 assert.throws(()=>assertSmokeResponse('get_card',{id:'wrong-printing',game:'pokemon'},{id:'base1-1'}))
 assert.throws(()=>assertSmokeResponse('refresh_price_checks',{ebay:null,soldcomps:null,errors:{ebay:'Unavailable'}},{source:'ebay'}))
 assert.throws(()=>assertSmokeResponse('get_artwork',{id:'synthetic',storage:'r2-private',downloadUrl:'https://assets.holofolder.com/pokemon/tcg/cards/en/base1/1/high.webp'},{id:'synthetic'}))
})

test('negative scenarios do not substitute for successful coverage or corrupt latency medians',()=>{
 const denied:ApiPerformanceSample={operation:'list_cards',scenario:'cross-owner-denial',phase:'first',status:404,expectedStatus:404,assertionsPassed:true,clientMs:10,serverMs:null,authMs:null,operationMs:null,bytes:1}
 assert.equal(summarizeApiPerformance([denied]).find(row=>row.operation==='list_cards')?.verified,false)
 const success={...denied,scenario:'default',status:200,expectedStatus:200,clientMs:100,serverMs:50}
 const row=summarizeApiPerformance([success,denied]).find(row=>row.operation==='list_cards')!
 assert.equal(row.verified,true);assert.equal(row.medianMs,100)
 assert.equal(summarizeApiPerformance([{...success,assertionsPassed:false}]).find(row=>row.operation==='list_cards')?.verified,false)
})


test('UI-only job starts require an asserted 403 and cannot pass with an arbitrary denial',()=>{
 const denied:ApiPerformanceSample={operation:'start_comparison_job',phase:'first',status:403,expectedStatus:403,assertionsPassed:true,clientMs:10,serverMs:null,authMs:null,operationMs:null,bytes:1}
 assert.equal(summarizeApiPerformance([denied]).find(row=>row.operation===denied.operation)?.verified,true)
 assert.equal(summarizeApiPerformance([{...denied,status:401,expectedStatus:401}]).find(row=>row.operation===denied.operation)?.verified,false)
 assert.equal(summarizeApiPerformance([{...denied,assertionsPassed:false}]).find(row=>row.operation===denied.operation)?.verified,false)
 assert.equal(summarizeApiPerformance([{...denied,operation:'list_cards'}]).find(row=>row.operation==='list_cards')?.verified,false)
})

test('native staged errors cannot pass receipt assertions or successful performance coverage',async()=>{
 const {assertSmokeResponse}=await import('../scripts/api-smoke-assertions')
 for(const operation of DEVELOPER_OPERATIONS.filter(op=>op.responseSchema)) {
  const denied={error:{code:'native_operations_staged',message:'Native storage operations are not enabled. Complete developer reads and rollout acceptance under #379 are still required.',requestId:'synthetic-staged-request'}}
  assert.throws(()=>assertSmokeResponse(operation.name,denied,{}))
  assert.throws(()=>assertSmokeResponse(operation.name,{inventoryRevision:1,privateEvidence:'synthetic'},{}))
  const sample:ApiPerformanceSample={operation:operation.name,phase:'first',status:503,expectedStatus:503,assertionsPassed:true,clientMs:1,serverMs:null,authMs:null,operationMs:null,bytes:1}
  const row=summarizeApiPerformance([sample]).find(row=>row.operation===operation.name)!
  assert.equal(row.verified,false);assert.equal(row.medianMs,null)
 }
})
