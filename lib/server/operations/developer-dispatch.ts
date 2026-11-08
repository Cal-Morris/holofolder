import {readDeveloperIdentity,updateDeveloperIdentity,developerBinderIdentity,developerSharing,developerAppearance,developerArtwork} from './management'
import {readDeveloperPartners,changeDeveloperPartner} from './partners'
import {listDeveloperPurchases,addDeveloperPurchase,removeDeveloperPurchase} from './show-purchases'
import {loadEbayListingIndicator} from '@/lib/server/ebay-listings'
import {regionalizeCardPrice,getRegionalFinishPrices,getGbpPerUnit} from '@/lib/regional-price'
import type {DisplayCurrency,PricingRegion} from '@/lib/pricing-region'
import {readComparisonOperation,writeComparisonOperation} from './comparisons'
import {readCollectionAnalytics,readDeveloperPriceHistory} from './analytics'
import {loadCardPriceChecks} from '@/lib/server/card-price-checks'
import {readImportLookups,resolveImportLookup} from '@/lib/collection-import-resolve'
import {findMirroredImportCandidates} from '@/lib/tcg-mirror'
import {checkDeal,normalizeDealThresholds} from '@/lib/deal-check'
import {getPriceDataAgeDays} from '@/lib/price-freshness'
import {getRisingMomentum} from '@/lib/price-momentum'
import {NextRequest} from 'next/server'
import {createAdminClient} from '@/lib/supabase/admin'
import type {OperationContext} from '@/lib/developer-api/types'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
import {decodePage,encodeCursor,paginateEntries} from '@/lib/developer-api/pagination'
import {normalizeCardLanguage,CARD_LANGUAGES} from '@/lib/domain/cards'
import {collectionFingerprint} from '@/lib/collection/sync'
import {normalizeCollectionItem} from '@/lib/collection/normalize'
import {resolveWriteBinderId} from '@/lib/server/binders'
import {sanitizeDeveloperImages} from '@/lib/server/developer-image-fields'
import {listCatalogCards,getCatalogCard,listCatalogGroups,getCatalogGroup} from './catalog'
import {listBinders,createBinder,updateBinder,deleteBinder} from './binders'
import {saveCollectionItem,deleteCollectionItem} from './collection'
import {getCollectionSettings,saveCollectionSettings} from './settings'
import {getMirroredIllustratorDirectory,getMirroredSetDexSlots} from '@/lib/tcg-mirror'
import {POKEMON_CATALOG} from '@/lib/pokemon-catalog'
import {loadSavedCardPrices,normalizeCardPriceLookups,refreshCardPriceLookups,loadDisplayFxRates} from '@/lib/card-pricing'

function paramsOf(input:Record<string,unknown>) {
 const params=new URLSearchParams()
 for(const [key,value] of Object.entries(input)) if(value!==undefined && value!==null && typeof value!=='object') params.set(key,String(value))
 return params
}
function operationRequest(input:Record<string,unknown>,method='POST') {
 const params=paramsOf(input);params.set('fingerprintVersion','2')
 return new NextRequest(`https://operations.holofolder.invalid/?${params}`,{method,headers:{'Content-Type':'application/json',...(typeof input.idempotencyKey==='string'?{'idempotency-key':input.idempotencyKey}:{})},...(method==='GET'||method==='DELETE'?{}:{body:JSON.stringify({...input,fingerprintVersion:2})})})
}
async function actor(context:OperationContext) {
 const {data,error}=await createAdminClient().auth.admin.getUserById(context.principal.actorId)
 if(error || !data.user) throw new DeveloperAccessError('invalid_actor','This account is no longer available.',401)
 return data.user
}
async function unwrap(response:Response) {
 const result=await response.json()
 if(!response.ok) throw new DeveloperAccessError(typeof result.code==='string'?result.code:response.status===409?'conflict':'operation_failed',response.status>=500?'This operation is temporarily unavailable.':typeof result.error==='string'?result.error:'The request could not be completed.',response.status>=500?503:response.status)
 return result
}
async function sanitizeImages(value:unknown):Promise<unknown> {
 const output=await sanitizeDeveloperImages(value)
 function fingerprints(raw:unknown,clean:unknown) {
  if(Array.isArray(raw)&&Array.isArray(clean)) {raw.forEach((row,index)=>fingerprints(row,clean[index]));return}
  if(!raw||typeof raw!=='object'||!clean||typeof clean!=='object')return
  const row=raw as Record<string,unknown>,target=clean as Record<string,unknown>
  if(typeof row.pokemon_id==='number'&&Array.isArray(row.wanted_cards))target.fingerprint=collectionFingerprint(normalizeCollectionItem(raw))
  for(const [key,child] of Object.entries(row))fingerprints(child,target[key])
 }
 fingerprints(value,output)
 return output
}

function sliceEntries<T>(entries:T[],input:Record<string,unknown>,key:(entry:T)=>string) {
 return paginateEntries(entries,paramsOf(input),key)
}
export async function executeDeveloperOperation(context:OperationContext,name:string,input:Record<string,unknown>):Promise<unknown> {
 const params=paramsOf(input),identity={id:context.principal.actorId}
 switch(name) {
  case 'list_cards': return listCatalogCards(params.toString())
  case 'get_card': {const card=await getCatalogCard(String(input.id),normalizeCardLanguage(input.language));if(!card) throw new DeveloperAccessError('not_found','Card not found.',404);return card}
  case 'list_sets': return listCatalogGroups('sets',params.toString())
  case 'list_series': return listCatalogGroups('series',params.toString())
  case 'get_set':case 'get_series': {
   const kind=name==='get_set'?'tcg_sets':'tcg_series'
   const data=await getCatalogGroup(kind,String(input.id))
   if(!data) throw new DeveloperAccessError('not_found','Catalog record not found.',404)
   return data
  }
  case 'list_languages': return {data:CARD_LANGUAGES}
  case 'list_pokemon': return sliceEntries(POKEMON_CATALOG.filter(p=>!input.q||p.name.toLowerCase().includes(String(input.q).toLowerCase())),input,p=>String(p.id).padStart(4,'0'))
  case 'get_pokemon': {const entry=POKEMON_CATALOG.find(p=>p.id===Number(input.id));if(!entry) throw new DeveloperAccessError('not_found','Pokémon not found.',404);return entry}
  case 'list_illustrators': return sliceEntries((await getMirroredIllustratorDirectory()).filter(p=>!input.q||p.name.toLowerCase().includes(String(input.q).toLowerCase())),input,p=>p.name)
  case 'list_binders': return unwrap(await listBinders(identity,context.ownerUserId))
  case 'create_binder': return unwrap(await createBinder(operationRequest(input),identity,context.ownerUserId))
  case 'update_binder':case 'reorder_binders': return unwrap(await updateBinder(operationRequest(input,'PATCH'),identity,context.ownerUserId))
  case 'delete_binder': {const request=operationRequest({...input,confirm:input.confirm?'1':'0'},'DELETE');return unwrap(await deleteBinder(request,identity,context.ownerUserId))}
  case 'list_collection': {
   const admin=createAdminClient(),binder=await resolveWriteBinderId(admin,context.ownerUserId,input.binderId),page=decodePage(params)
   let query=admin.from('pokemon_collection').select('*').eq('user_id',context.ownerUserId).eq('binder_id',binder).order('pokemon_id').limit(page.limit+1)
   if(page.after) {if(!/^\d{1,6}$/.test(page.after))throw new DeveloperAccessError('invalid_cursor','Invalid collection cursor.',400);query=query.gt('pokemon_id',Number(page.after))}
   if(input.status) query=query.eq('status',input.status)
   const {data,error}=await query;if(error)throw new Error('Collection read unavailable')
   const rows=data??[];return {data:await sanitizeImages(rows.slice(0,page.limit)),nextCursor:rows.length>page.limit?encodeCursor(String(rows[page.limit-1].pokemon_id),params):null,absentFingerprint:collectionFingerprint(null)}
  }
  case 'save_collection_item': return sanitizeImages(await unwrap(await saveCollectionItem(operationRequest(input),await actor(context),true,context)))
  case 'delete_collection_item': return unwrap(await deleteCollectionItem(operationRequest(input,'DELETE'),identity,true,context.ownerUserId))
  case 'get_settings': return unwrap(await getCollectionSettings(operationRequest(input,'GET'),identity,true,context.ownerUserId))
  case 'get_prices': return {prices:await loadSavedCardPrices(normalizeCardPriceLookups(input.cards as unknown[]))}
  case 'update_settings': return unwrap(await saveCollectionSettings(operationRequest(input,'PUT'),identity,true,context.ownerUserId))
  case 'refresh_prices': return refreshCardPriceLookups(normalizeCardPriceLookups(input.cards as unknown[]),{force:false})
  case 'get_price_checks':case 'refresh_price_checks': {
   const result=await loadCardPriceChecks(String(input.id),String(input.finish??'any'),name==='refresh_price_checks',input.source as 'ebay'|'soldcomps'|undefined)
   if(!result)throw new DeveloperAccessError('unsupported_printing','This exact printing is not supported yet.',422)
   return sanitizeImages(result)
  }
  case 'get_comparison_job':return unwrap(await readComparisonOperation(operationRequest(input,'GET'),identity,context.ownerUserId))
  case 'inspect_comparison_job':case 'start_comparison_job':case 'cancel_comparison_job': {
   const action=name==='inspect_comparison_job'?'inspect':name==='cancel_comparison_job'?'stop':'start'
   return unwrap(await writeComparisonOperation(operationRequest({...input,action}),identity,context.ownerUserId))
  }
  case 'get_price_history':return readDeveloperPriceHistory(input)
  case 'get_collection_analytics':return sanitizeImages(await unwrap(await readCollectionAnalytics(operationRequest(input,'GET'),identity,context.ownerUserId)))
  case 'resolve_import': {
   let lookups
   try{lookups=readImportLookups(input)}catch{throw new DeveloperAccessError('invalid_import','Use between 1 and 25 valid catalog identities.',400)}
   const results=[]
   for(let n=0;n<lookups.length;n+=3)results.push(...await Promise.all(lookups.slice(n,n+3).map(async lookup=>resolveImportLookup(lookup,await findMirroredImportCandidates(lookup)))))
   return sanitizeImages({results})
  }
  case 'check_deal': {
   const [[stored],fxRates]=await Promise.all([loadSavedCardPrices(normalizeCardPriceLookups([{cardId:input.cardId,language:input.language}])),loadDisplayFxRates()])
   const region=(input.region??'UK') as PricingRegion,currency=input.currency as DisplayCurrency
   const snapshot=stored?regionalizeCardPrice(stored,region):null
   const price=input.finish&&stored?getRegionalFinishPrices(stored,region)[input.finish as 'normal'|'holo'|'reverse_holo']:snapshot
   const confidence=price?.confidence??'unknown',rate=getGbpPerUnit(currency,fxRates,snapshot??undefined)
   const trusted=confidence==='high'||confidence==='medium'
   const market=rate&&price?.gbpAmount?price.gbpAmount/rate:null
   const verdict=trusted?checkDeal({askingPrice:Number(input.askingPrice),marketPrice:market,confidence,dataAgeDays:getPriceDataAgeDays(price?.updatedAt,Date.now()),isRising:snapshot?Boolean(getRisingMomentum(snapshot,Date.now())):false,thresholds:normalizeDealThresholds(input.thresholds)}):null
   return {currency,region,marketPrice:market,price:price??null,verdict,reason:verdict?null:!rate?'A verified exchange rate is not available.':'A reliable saved market price is not available.'}
  }
  case 'get_set_slots': {
   const result=await getMirroredSetDexSlots(String(input.id),normalizeCardLanguage(input.language),undefined,true)
   if(!result.selectedSet)throw new DeveloperAccessError('not_found','Set not found.',404)
   const page=sliceEntries(result.slots,input,slot=>String(slot.dexId).padStart(4,'0'))
   return sanitizeImages({...page,data:page.data.map(slot=>({dexId:slot.dexId,pokemonName:slot.pokemonName,cardIds:slot.cards.slice(0,100).map(card=>card.id),cardCount:slot.cards.length,hasMoreCards:slot.cards.length>100})),selectedSet:result.selectedSet})
  }
  case 'get_listings': {
   const result=await loadEbayListingIndicator(String(input.id),input.finish==='reverse_holo'?'reverse':input.finish as 'normal'|'holo'|undefined??null)
   if(!result)throw new DeveloperAccessError('unsupported_printing','This exact printing is not supported by listing lookup.',422)
   return sanitizeImages(result)
  }
  case 'get_identity':return readDeveloperIdentity(context)
  case 'update_identity':return updateDeveloperIdentity(context,input)
  case 'get_binder_identity':return developerBinderIdentity(context,input)
  case 'update_binder_identity':return developerBinderIdentity(context,input,true)
  case 'get_sharing':return developerSharing(context,input)
  case 'update_sharing':return developerSharing(context,input,true)
  case 'get_appearance':return developerAppearance(context,input)
  case 'update_appearance':return developerAppearance(context,input,true)
  case 'list_partners':return readDeveloperPartners(await actor(context),params)
  case 'invite_partner':return changeDeveloperPartner(context.principal.actorId,'invite',input)
  case 'accept_partner_invite':return changeDeveloperPartner(context.principal.actorId,'accept',input)
  case 'reject_partner_invite':return changeDeveloperPartner(context.principal.actorId,'reject',input)
  case 'disconnect_partner':return changeDeveloperPartner(context.principal.actorId,'disconnect',input)
  case 'list_show_purchases':return listDeveloperPurchases(context,params)
  case 'add_show_purchase':return addDeveloperPurchase(context,input)
  case 'remove_show_purchase':return removeDeveloperPurchase(context,String(input.clientId))
  case 'prepare_artwork_upload':return developerArtwork(context,input,true)
  case 'get_artwork':return developerArtwork(context,input)
  default:throw new DeveloperAccessError('not_found','Operation not found.',404)
 }
}
