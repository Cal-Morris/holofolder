import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { DEVELOPER_OPERATIONS, matchRestOperation } from '@/lib/developer-api/operations'
import { matchesCatalogCardId } from '@/lib/card-catalog'
import { inventoryItemCandidate } from '@/lib/domain/inventory'
import { matchesSlotTarget } from '@/lib/domain/binder-slots'

test('public discovery retires species-row access and names Pokemon-only helpers explicitly',()=>{
 for(const name of ['list_collection','save_collection_item','delete_collection_item','get_set_slots','get_collection_analytics','get_legacy_pokemon_analytics','resolve_import']) assert.ok(!DEVELOPER_OPERATIONS.some(op=>op.name===name))
 for(const [method,path] of [['GET','/collection'],['POST','/collection'],['DELETE','/collection/1'],['GET','/sets/base1/slots'],['GET','/analytics'],['GET','/legacy/pokemon/analytics'],['POST','/imports/resolve']]) assert.equal(matchRestOperation(method,path),null)
 for(const [path,name] of [['/pokemon/sets/base1/slots','get_pokemon_set_slots']]) {
  const op=matchRestOperation('GET',path)!.operation
  assert.equal(op.name,name)
  assert.ok(op.permissions.includes('catalog:read')||op.permissions.includes('collection:read'))
 }
 const schema=DEVELOPER_OPERATIONS.find(op=>op.name==='list_collection_audit')!.schema
 assert.equal(schema.safeParse({inventoryItemId:'synthetic-copy'}).success,true)
 assert.equal(schema.safeParse({itemId:'synthetic-copy'}).success,false)
 // No selector is offered yet, including a silently ignored unsupported game.
 for(const name of ['list_cards','get_card','list_sets','get_set','list_series','get_series']) {
  const schema=DEVELOPER_OPERATIONS.find(op=>op.name===name)!.schema
  assert.equal(schema.safeParse({id:'synthetic',game:'other-game'}).success,false)
 }
})

test('catalog projections preserve opaque IDs and declare the only supported game for cards, sets and series',()=>{
 execFileSync(process.execPath,[new URL('./fixtures/public-catalog-identity.ts',import.meta.url).pathname],{stdio:'pipe'})
})

test('provider-local identifiers cannot stand in for a global printing or a species identity',()=>{
 const card={kind:'card' as const,id:'synthetic-global',canonicalId:'synthetic-canonical',aliasIds:['synthetic-reviewed-alias'],pokemonIds:[],external_ids_json:{catalog:{canonicalId:'synthetic-canonical',aliasIds:['synthetic-reviewed-alias']},tcgdex:{thirdParty:{tcgplayer:42}}}}
 assert.equal(matchesCatalogCardId(card,'42'),false)
 assert.equal(matchesCatalogCardId(card,'synthetic-reviewed-alias'),true)
 assert.equal(matchesCatalogCardId(card,'unrelated-global'),false)
 const item={id:'synthetic-copy',ownerUserId:'synthetic-owner',identity:{kind:'card' as const,cardId:'unrelated-global'},grading:null,acquiredAt:null,version:0}
 assert.equal(inventoryItemCandidate(item,()=>card),undefined,'a resolver cannot lend another printing its aliases')
 assert.equal(matchesSlotTarget(card,{kind:'pokemon',pokemonId:1}),false,'no dex links means no species match')
 assert.equal(matchesSlotTarget(card,{kind:'card',cardId:card.id}),true,'Trainer and Energy printings remain valid card targets')
 assert.equal(matchesSlotTarget(card,null),true,'free targets accept a printing without dex links')
})

test('current operator guides describe admitted native APIs and preserve separate app acceptance',async()=>{
 const {readFile}=await import('node:fs/promises')
 for(const file of ['native-developer-operations.md','native-developer-read.md']) {
  const guide=await readFile(new URL('../docs/'+file,import.meta.url),'utf8')
  assert.doesNotMatch(guide,/always throws|fixed denied|fixed-denied|same fixed admission denial|separate subprocesses for the real fixed guard/)
  assert.match(guide,/authenticated/)
  assert.match(guide,/hosted/)
  assert.match(guide,/inventoryItemId/)
 }
})
