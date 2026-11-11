import {CATALOG_GAME,readExternalIdentifiers} from '@/lib/developer-api/catalog'
import {developerArtworkReference} from '@/lib/developer-api/image-identity'
import { cacheLife, cacheTag } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { CARD_LANGUAGES, isCardLanguage, type CardLanguage } from '@/lib/domain/cards'
import { DeveloperAccessError } from '@/lib/developer-api/permissions'
import { decodePage, encodeCursor } from '@/lib/developer-api/pagination'
import { pickLocalizedText, buildTcgdexAssetImageUrl } from '@/lib/tcgdex-shared'
import { readCatalogMetadata } from '@/lib/card-catalog'
import { pickCardImageUrl } from '@/lib/card-image-sources'
import { parseCardSearchQuery } from '@/lib/pokemon-card-browse'
import { correctedCardSearchQuery, resolveCardSearchQuery } from '@/lib/card-search-query'
import { createDeveloperImageResolver, type DeveloperImageResolver } from '@/lib/server/developer-images'
import { sanitizeDeveloperImages } from '@/lib/server/developer-image-fields'

const CARD_COLUMNS='raw_json,id,series_id,set_id,local_id,name_json,category,rarity,hp,illustrator,types_json,image_languages_json,external_ids_json,variants_json,tcg_sets(id,name_json,official_card_count,release_date)'
const ATTRIBUTION='Card data: TCGdex and identified sources. Card images © The Pokémon Company, Nintendo, Creatures, GAME FREAK.'
function language(params:URLSearchParams):CardLanguage {
 const value=params.get('language')??'en'
 if(!isCardLanguage(value)) throw new DeveloperAccessError('invalid_language','Choose a supported card language.',400)
 return value
}
function record(value:unknown):Record<string,unknown> {return value && typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}
function text(value:unknown):string|null {return typeof value==='string'?value:null}
function strings(value:unknown):string[] {return Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'):[]}
function cardSource(value:unknown,lang:CardLanguage) {
 const row=record(value),available=strings(row.image_languages_json)
 const imageLanguage=available.includes(lang)?lang:available.find(l=>CARD_LANGUAGES.includes(l as CardLanguage))
 const tcgdexImage=imageLanguage?buildTcgdexAssetImageUrl(imageLanguage,String(row.series_id),String(row.set_id),String(row.local_id)):null
 return pickCardImageUrl(row.external_ids_json,imageLanguage??null,tcgdexImage,lang)??null
}
async function serializeCard(value:unknown,lang:CardLanguage,resolve:DeveloperImageResolver) {
 const row=record(value), set=record(row.tcg_sets),metadata=readCatalogMetadata(row.external_ids_json)
 const available=strings(row.image_languages_json)
 const imageLanguage=available.includes(lang)?lang:available.find(l=>CARD_LANGUAGES.includes(l as CardLanguage))
 const source=cardSource(value,lang)
 const image=await resolve(source)
 const identifiers=readExternalIdentifiers(row.external_ids_json)
 return {id:row.id,game:CATALOG_GAME,canonicalId:metadata.canonicalId??row.id,aliasIds:metadata.aliasIds??[],localId:metadata.localId??row.local_id,name:pickLocalizedText(row.name_json,lang),names:record(row.name_json),language:lang,
  set:{id:row.set_id,game:CATALOG_GAME,name:pickLocalizedText(set.name_json,lang),officialCardCount:set.official_card_count??null,releaseDate:set.release_date??null},seriesId:row.series_id,
  category:text(row.category),rarity:text(row.rarity),hp:typeof row.hp==='number'?row.hp:null,illustrator:text(row.illustrator),types:strings(row.types_json),variants:Object.fromEntries(Object.entries(record(row.variants_json)).filter(([,value])=>typeof value==='boolean')),externalIds:identifiers,details:await sanitizeDeveloperImages(record(row.raw_json),resolve),
  artworkRef:source?developerArtworkReference(source):null,image:image.url,imageAvailability:image.availability,imageLanguage:imageLanguage??null,attribution:ATTRIBUTION}
}
async function cardPage(rows:unknown[],lang:CardLanguage) {
 const resolve=await createDeveloperImageResolver([rows,rows.map(row=>cardSource(row,lang))])
 const cards=[]
 for(let i=0;i<rows.length;i+=8) cards.push(...await Promise.all(rows.slice(i,i+8).map(row=>serializeCard(row,lang,resolve))))
 return cards
}
async function listSetsForSearch(query:string) {
 const {data,error}=await createAdminClient().from('tcg_sets').select('id,name_en').or(`id.ilike.${JSON.stringify(`%${query}%`)},name_en.ilike.${JSON.stringify(`%${query}%`)}`).order('id').limit(100)
 if(error) throw new Error('Set search unavailable')
 return (data??[]).map(set=>({id:set.id,name:set.name_en??set.id}))
}
export async function listCatalogCards(rawParams:string) {
 'use cache: remote'
 cacheLife({stale:60,revalidate:60,expire:120});cacheTag('tcg-mirror')
 const params=new URLSearchParams(rawParams),page=decodePage(params),lang=language(params)
 const q=params.get('q')??''
 if(q.length>80) throw new DeveloperAccessError('invalid_query','Search queries must be at most 80 characters.',400)
 const admin=createAdminClient()
 let query=admin.from('tcg_cards').select(params.has('pokemon')?`${CARD_COLUMNS},tcg_card_dex_ids!inner(dex_id)`:CARD_COLUMNS).order('id').limit(page.limit+1)
 if(page.after) query=query.gt('id',page.after)
 for(const [parameter,column] of [['set','set_id'],['series','series_id'],['illustrator','illustrator']] as const) {
  const value=params.get(parameter)
  if(value) {if(value.length>200) throw new DeveloperAccessError('invalid_filter','Filter values must be at most 200 characters.',400);query=query.eq(column,value)}
 }
 const pokemon=params.get('pokemon')
 if(pokemon) {
  if(!/^\d{1,4}$/.test(pokemon)||Number(pokemon)<1) throw new DeveloperAccessError('invalid_pokemon','Provide a valid Pokédex number.',400)
  query=query.eq('tcg_card_dex_ids.dex_id',Number(pokemon))
 }
 let correction:string|null=null
 if(q) {
  const basic=parseCardSearchQuery(q)
  const sets=await listSetsForSearch(basic.text||q)
  const parsed=resolveCardSearchQuery(q,sets);correction=correctedCardSearchQuery(q,sets)
  if(parsed.cardId) query=query.ilike('id',parsed.cardId)
  else {
   if(parsed.setIds.length) query=query.in('set_id',parsed.setIds)
   if(parsed.text) {const value=JSON.stringify(`%${parsed.text}%`);query=query.or(`name_json->>${lang}.ilike.${value},name_en.ilike.${value},illustrator.ilike.${value}`)}
   if(parsed.number) query=query.in('local_id',[parsed.number,parsed.number.padStart(2,'0'),parsed.number.padStart(3,'0')])
  }
 }
 const {data,error}=await query
 if(error) throw new Error('Catalog lookup unavailable')
 const rows=data??[],visible=rows.slice(0,page.limit)
 return {data:await cardPage(visible,lang),nextCursor:rows.length>page.limit?encodeCursor(String(record(visible.at(-1)).id),params):null,correction}
}
export async function getCatalogCard(id:string,lang:CardLanguage) {
 'use cache: remote'
 cacheLife({stale:60,revalidate:60,expire:120});cacheTag('tcg-mirror')
 const {data,error}=await createAdminClient().from('tcg_cards').select(CARD_COLUMNS).eq('id',id).maybeSingle()
 if(error) throw new Error('Card lookup unavailable')
 return data?(await cardPage([data],lang))[0]:null
}
export async function listCatalogGroups(kind:'sets'|'series',rawParams:string) {
 'use cache: remote'
 cacheLife('hours');cacheTag('tcg-mirror')
 const params=new URLSearchParams(rawParams),page=decodePage(params),lang=language(params)
 const columns=kind==='sets'?'id,series_id,name_json,official_card_count,release_date':'id,name_json'
 let query=createAdminClient().from(kind==='sets'?'tcg_sets':'tcg_series').select(columns).order('id').limit(page.limit+1)
 if(page.after) query=query.gt('id',page.after)
 if(params.get('series')&&kind==='sets') query=query.eq('series_id',params.get('series')!)
 const {data,error}=await query
 if(error) throw new Error('Catalog groups unavailable')
 const rows=(data??[]).map(record),visible=rows.slice(0,page.limit)
 return {data:visible.map(row=>({id:row.id,game:CATALOG_GAME,name:pickLocalizedText(row.name_json,lang),names:record(row.name_json),...(kind==='sets'?{seriesId:row.series_id,officialCardCount:row.official_card_count??null,releaseDate:row.release_date??null}:{})})),nextCursor:rows.length>page.limit?encodeCursor(String(record(visible.at(-1)).id),params):null}
}

export async function getCatalogGroup(kind:'tcg_sets'|'tcg_series',id:string) {
 'use cache: remote'
 cacheLife('hours');cacheTag('tcg-mirror')
 const {data,error}=await createAdminClient().from(kind).select(kind==='tcg_sets'?'id,series_id,name_json,official_card_count,release_date,raw_json':'id,name_json,raw_json').eq('id',id).maybeSingle()
 if(error)throw new Error('Catalog lookup unavailable')
 return data?sanitizeDeveloperImages({...record(data),game:CATALOG_GAME}):null
}
