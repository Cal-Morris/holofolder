import {PRESET_OPERATIONS} from "../lib/developer-api/presets"
import { rawRestoreErrorSchema, creationErrorSchema, importErrorSchema, storageCommandErrorSchema } from '../lib/developer-api/storage'
import {NATIVE_READ_OPERATIONS} from "../lib/developer-api/native-read"
import assert from 'node:assert/strict'
import {NATIVE_DEVELOPER_OPERATIONS} from '../lib/developer-api/storage'

type Row=Record<string,unknown>
type Check=(value:Row,input:Row)=>void
const object=(value:unknown):Row=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'Expected a JSON object');return value as Row}
const string=(value:unknown)=>assert.equal(typeof value,'string','Expected a string')
const array=(value:unknown):unknown[]=>{assert.ok(Array.isArray(value),'Expected an array');return value}
const page:Check=(value,input)=>{assert.ok(array(value.data).length<=Number(input.limit??50),'Page exceeds requested limit');assert.ok(value.nextCursor===null||typeof value.nextCursor==='string','Missing pagination cursor')}
const binders:Check=value=>{for(const item of array(value.binders)){const row=object(item);string(row.id);assert.ok(Number.isSafeInteger(row.slotCount)&&Number(row.slotCount)>=0,'Invalid slot count')}}
const settings:Check=value=>{object(value.settings);string(value.fingerprint);assert.equal(typeof value.hasStoredSettings,'boolean')}
const appearance:Check=value=>{assert.ok(value.design===null||typeof value.design==='object');assert.ok(Number.isSafeInteger(value.revision)&&Number(value.revision)>=0)}
const job:Check=value=>{const row=object(value.job);string(row.id);assert.ok(['queued','running','completed','cancelled','failed'].includes(String(row.status)),'Unknown job state')}
const identity:Check=value=>{assert.ok(value.username===null||typeof value.username==='string');assert.ok(value.displayName===null||typeof value.displayName==='string')}
const binderIdentity:Check=value=>{assert.ok(value.username===null||typeof value.username==='string');assert.ok(value.slug===null||typeof value.slug==='string')}
const sharing:Check=value=>{if(value.share!==null){const share=object(value.share);string(share.token);assert.equal(typeof share.is_enabled,'boolean')}}
const checks:Check=value=>{object(value.errors);for(const source of ['ebay','soldcomps'])if(value[source]!==null){const result=object(value[source]);object(result.summary);string(result.checkedAt)}}
const succeeded:Check=value=>assert.equal(value.success,true)
const id:Check=value=>string(value.id)

// Every registered operation needs a successful response assertion, including mutations.
export const API_SMOKE_ASSERTIONS:Record<string,Check>={
 ...Object.fromEntries([...NATIVE_DEVELOPER_OPERATIONS,...NATIVE_READ_OPERATIONS,...PRESET_OPERATIONS].map(operation=>[operation.name,(value:Row)=>{
  assert.ok(operation.responseSchema?.safeParse(value).success,'Invalid native receipt for '+operation.name)
 }])),
 list_cards:page,
 get_card:(value,input)=>{assert.equal(value.id,input.id);string(value.canonicalId);object(value.set);assert.ok(value.image===null||typeof value.image==='string')},
 list_sets:page,get_set:(value,input)=>assert.equal(value.id,input.id),
 list_series:page,get_series:(value,input)=>assert.equal(value.id,input.id),
 list_languages:value=>assert.ok(array(value.data).includes('en')),
 list_pokemon:page,get_pokemon:(value,input)=>assert.equal(value.id,Number(input.id)),list_illustrators:page,
 list_binders:binders,
 create_binder:(value,input)=>{binders(value,input);string(value.createdBinderId);assert.ok(array(value.binders).some(row=>object(row).id===value.createdBinderId))},
 update_binder:(value,input)=>{binders(value,input);assert.equal(object(array(value.binders).find(row=>object(row).id===input.id)).name,input.name)},
 reorder_binders:(value,input)=>{binders(value,input);assert.deepEqual(array(value.binders).map(row=>object(row).id),input.order)},
 delete_binder:(value,input)=>{binders(value,input);assert.equal(value.deletedBinderId,input.id);assert.ok(!array(value.binders).some(row=>object(row).id===input.id))},
 list_collection:(value,input)=>{page(value,input);string(value.absentFingerprint);for(const item of array(value.data))string(object(item).fingerprint)},
 save_collection_item:(value,input)=>{const item=object(value.item);assert.equal(item.pokemon_id,input.pokemonId);assert.equal(item.status,input.status);assert.equal(item.card_id,input.cardId)},
 delete_collection_item:succeeded,
 get_settings:settings,update_settings:settings,
 get_prices:value=>{array(value.prices)},
 refresh_prices:value=>{array(value.prices);for(const key of ['refreshed','cached','unpriced'])assert.ok(Number.isSafeInteger(value[key])&&Number(value[key])>=0)},
 get_price_checks:checks,
 refresh_price_checks:(value,input)=>{checks(value,input);assert.equal(object(value.errors)[String(input.source??'ebay')],undefined,'Requested comparison provider returned an error')},
 get_comparison_job:job,
 inspect_comparison_job:value=>{assert.ok(Number.isSafeInteger(value.needed)&&Number(value.needed)>=0);assert.ok(value.job===null||typeof value.job==='object')},
 start_comparison_job:job,cancel_comparison_job:job,
 get_price_history:page,
 list_collection_audit:page,
 get_collection_audit:value=>{assert.equal(typeof value.id,'string');assert.ok(['unknown','user','system'].includes(String(value.actor_kind)));assert.ok(!('recovery_state' in value));assert.ok(!('command_evidence' in value))},
 preview_collection_recovery:(value,input)=>{assert.equal(value.eventId,input.eventId);assert.equal(value.planVersion,1);assert.equal(typeof value.supported,'boolean');assert.ok(Array.isArray(value.conflicts));assert.ok(Array.isArray(value.unsupported));assert.ok(Array.isArray(value.changes));assert.ok(value.planToken===null||typeof value.planToken==='string'&&/^[a-f0-9]{64}$/.test(value.planToken))},
 apply_collection_recovery:(value,input)=>{assert.equal(value.recoveredEventId,input.eventId);assert.equal(typeof value.eventId,'string');assert.notEqual(value.eventId,value.recoveredEventId)},
 get_collection_analytics:value=>{array(value.activity);array(value.priceHistory);assert.equal(typeof value.historyAvailable,'boolean')},
 resolve_import:value=>{assert.ok(array(value.results).length>0)},
 check_deal:value=>{assert.equal(value.currency,'GBP');assert.ok(value.verdict===null||typeof value.verdict==='object')},
 get_set_slots:(value,input)=>{page(value,input);assert.equal(object(value.selectedSet).id,input.id)},
 get_listings:value=>{object(value.summary);array(value.listings);string(value.checkedAt)},
 get_identity:identity,update_identity:identity,
 get_binder_identity:binderIdentity,update_binder_identity:binderIdentity,
 get_sharing:sharing,update_sharing:sharing,
 get_appearance:appearance,update_appearance:appearance,
 list_partners:value=>{array(value.invites);assert.ok(value.partnership===null||typeof value.partnership==='object')},
 invite_partner:id,accept_partner_invite:succeeded,
 reject_partner_invite:value=>assert.equal(value.rejected,true),disconnect_partner:succeeded,
 list_show_purchases:page,
 add_show_purchase:(value,input)=>assert.equal(object(value.purchase).id,input.clientId),
 remove_show_purchase:value=>assert.equal(value.removed,true),
 prepare_artwork_upload:value=>{string(value.signedUploadUrl);object(value.headers);assert.equal(value.method,'PUT');assert.equal(value.storage,'r2-private')},
 get_artwork:(value,input)=>{assert.equal(value.id,input.id);assert.equal(value.storage,'r2-private');const url=new URL(String(value.downloadUrl));assert.ok(url.hostname.endsWith('.r2.cloudflarestorage.com')&&url.searchParams.has('X-Amz-Signature'),'Expected a private signed R2 download')},
}
export function assertSmokeResponse(operation:string,value:unknown,input:Row) {
 const check=API_SMOKE_ASSERTIONS[operation]
 assert.ok(check,'Missing response assertion for '+operation)
 check(object(value),input)
}

/** Staging evidence is separate from successful execution and latency coverage. */
export function assertStagedSmokeResponse(operation:string,value:unknown) {
 assert.ok([...NATIVE_DEVELOPER_OPERATIONS,...NATIVE_READ_OPERATIONS,...PRESET_OPERATIONS].some(op=>op.name===operation&&op.admission==='staged'),'Operation is not staged')
 const body=object(value),error=object(body.error)
 assert.deepEqual(Object.keys(body),['error'])
 assert.deepEqual(Object.keys(error).sort(),['code','message','requestId'])
 assert.equal(error.code,'native_operations_staged')
 assert.equal(error.message,'Native storage operations are not enabled. Complete developer reads and rollout acceptance under #379 are still required.')
 string(error.requestId);assert.ok(String(error.requestId).trim().length>0,'Missing request ID')
}

/** Terminal rejection is an error outcome, never successful execution coverage or an inferred conflict. */
export function assertTerminalStorageSmokeResponse(operation:string,value:unknown,input:Row) {
 const registered=NATIVE_DEVELOPER_OPERATIONS.find(op=>op.name===operation)
 assert.ok(registered?.errorSchemas?.[409], 'Operation has no terminal rejection contract')
 const schema=operation==='restore_raw_collection_content'?rawRestoreErrorSchema:operation==='create_storage_collection'?creationErrorSchema:operation==='import_storage_arrangement'?importErrorSchema:storageCommandErrorSchema
 const parsed=schema.parse(value)
 assert.equal(parsed.error.rejection.operationId,input.operationId,'Terminal proof must bind the original operation ID')
}

/** Called before a sample is marked passed or persisted, including staged error-body checks. */
export function assertSmokeHttpResponse(operation:string,status:number,value:unknown,input:Row,expectedStatus:number,scenario:string) {
 assert.ok(API_SMOKE_ASSERTIONS[operation],'Missing response assertion for '+operation)
 assert.equal(status,expectedStatus,`Unexpected HTTP status for ${operation}`)
 const staged=[...NATIVE_DEVELOPER_OPERATIONS,...NATIVE_READ_OPERATIONS,...PRESET_OPERATIONS].some(op=>op.name===operation&&op.admission==='staged')
 if(staged) {
  assert.equal(scenario,'native-staged','Native smoke is denial-only')
  assert.equal(expectedStatus,503,'Native smoke requires fixed 503 admission')
  assertStagedSmokeResponse(operation,value)
 } else if(expectedStatus<400)assertSmokeResponse(operation,value,input)
 else {const error=object(object(value).error);string(error.code)}
}
