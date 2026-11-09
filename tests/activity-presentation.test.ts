import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activitySummary, readableActivityChanges, activityDay, activityReceipt } from '../lib/activity-presentation'
import type { ActivityEvent } from '../lib/collection-activity'

// Synthetic histories, including the removed-card example.
const base: ActivityEvent = { id:'1',recorded_at:'2026-11-09T12:00:00Z',format_version:1,actor_kind:'user',source:'app',action:'collection_item',affected_entities:{collectionIds:['binder']},changes:[] }
const row = {pokemon_id:1,pokemon_name:'Bulbasaur',card_name:'Bulbasaur',card_id:'mep-037',card_set:'MEP Black Star Promos',status:'collected',card_finish:'holo',card_language:'en',binder_id:'binder'}
test('removed cards show one readable action and printing, not a wall of missing fields',()=>{
  const event = {...base,changes:[{table:'pokemon_collection',id:'row',before:row,after:null}]}
  assert.equal(activitySummary(event,[{id:'binder',name:'test'}]).title,'Removed Bulbasaur from test')
  const changes = readableActivityChanges(event)
  assert.equal(changes[0].subtitle,'MEP Black Star Promos · #037 · Holo · English')
  assert.deepEqual(changes[0].fields,[])
  assert.doesNotMatch(JSON.stringify(changes),/None|binder_id|mep-037/)
})
test('wants, owned cards, rename and bulk changes have meaningful verbs',()=>{
  const make = (before: Record<string,unknown>|null,after:Record<string,unknown>|null,table='pokemon_collection')=>({...base,changes:[{table,id:'row',before,after}]})
  assert.match(activitySummary(make(null,row)).title,/Added Bulbasaur/)
  assert.match(activitySummary(make({...row,status:'wishlisted'},row)).title,/Collected Bulbasaur/)
  assert.match(activitySummary(make(row,{...row,wanted_cards:[{card_name:'Bulbasaur',card_id:'other'}]})).title,/want list/)
  assert.equal(activitySummary(make({name:'Old'},{name:'New'},'binders')).title,'Renamed Old to New')
  assert.equal(activitySummary({...base,changes:Array.from({length:12},(_,i)=>({table:'pokemon_collection',id:String(i),before:null,after:row}))}).title,'Added 12 cards')
  assert.match(activitySummary({...base,action:'recovery.apply',recovery_of_event_id:'5'}).title,/Undid/)
})
test('details suppress identifiers, format values and keep unknowns honest',()=>{
  const event = {...base,changes:[{table:'pokemon_collection',id:'row',before:row,after:{...row,card_finish:'reverse_holo',card_language:'ja'}}]}
  assert.deepEqual(readableActivityChanges(event)[0].fields,[{label:'Finish',before:'Holo',after:'Reverse holo'},{label:'Language',before:'English',after:'Japanese'}])
  assert.equal(activityDay('invalid'),'Earlier')
  const printing={...base,changes:[{table:'pokemon_collection',id:'row',before:row,after:{...row,card_id:'mep-038'}}]}
  assert.deepEqual(readableActivityChanges(printing)[0].fields,[{label:'Printing',before:'MEP Black Star Promos · #037',after:'MEP Black Star Promos · #038'}])
})

test('receipts expand only useful deltas or bulk changes and offer supported Undo',()=>{
  const make = (before: Record<string,unknown>|null,after:Record<string,unknown>|null,table='pokemon_collection')=>({...base,changes:[{table,id:'row',before,after}]})
  assert.equal(activityReceipt(make(null,row)).hasDetails,false)
  assert.equal(activityReceipt(make(row,null)).hasDetails,false)
  assert.equal(activityReceipt(make(row,{...row,card_id:'mep-038'})).hasDetails,true)
  assert.equal(activityReceipt({...base,changes:[...make(null,row).changes,...make(null,row).changes]}).hasDetails,true)
  assert.equal(activityReceipt(make(null,row)).canUndo,true)
  assert.equal(activityReceipt(make(null,{name:'Binder'},'binders')).canUndo,false)
  assert.equal(activityReceipt({...make(null,row),format_version:0}).canUndo,false)
  assert.equal(activityReceipt({...make(null,row),action:'recovery.apply'}).canUndo,false)
})
