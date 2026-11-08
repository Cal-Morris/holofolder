import {createAdminClient} from '@/lib/supabase/admin'
import type {OperationContext} from '@/lib/developer-api/types'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
import {decodePage,encodeCursor} from '@/lib/developer-api/pagination'
import {SHOW_PURCHASE_COLUMNS,fromShowPurchaseRow} from '@/lib/show-purchase-sync'
export async function listDeveloperPurchases(context:OperationContext,params:URLSearchParams) {
 const page=decodePage(params)
 let query=createAdminClient().from('show_purchases').select(SHOW_PURCHASE_COLUMNS).eq('owner_user_id',context.ownerUserId).order('client_id').limit(page.limit+1)
 if(page.after)query=query.gt('client_id',page.after)
 if(params.get('since'))query=query.gte('bought_at',params.get('since')!)
 const {data,error}=await query;if(error)throw new Error('Show purchases unavailable')
 const rows=data??[]
 return {data:rows.slice(0,page.limit).map(fromShowPurchaseRow),nextCursor:rows.length>page.limit?encodeCursor(rows[page.limit-1].client_id,params):null}
}
export async function addDeveloperPurchase(context:OperationContext,input:Record<string,unknown>) {
 const admin=createAdminClient(),row={owner_user_id:context.ownerUserId,created_by:context.principal.actorId,client_id:input.clientId,card_id:input.cardId,card_name:input.cardName,language:input.language??'en',finish:input.finish??'normal',price:input.price,market_price:input.marketPrice??null,currency:input.currency,bought_at:input.boughtAt,bundle_id:input.bundleId??null}
 const {error}=await admin.from('show_purchases').upsert(row,{onConflict:'owner_user_id,client_id',ignoreDuplicates:true})
 if(error)throw new Error('Show purchase could not be saved')
 const {data,error:readError}=await admin.from('show_purchases').select(SHOW_PURCHASE_COLUMNS).eq('owner_user_id',context.ownerUserId).eq('client_id',input.clientId).single()
 if(readError)throw new Error('Show purchase could not be read')
 const purchase=fromShowPurchaseRow(data)
 if(!purchase)throw new Error('Invalid stored purchase')
 if(purchase.cardId!==input.cardId||purchase.cardName!==input.cardName||purchase.language!==row.language||purchase.finish!==row.finish||purchase.price!==input.price||purchase.marketPrice!==row.market_price||purchase.currency!==input.currency||purchase.at!==Date.parse(String(input.boughtAt))||(purchase.bundleId??null)!==row.bundle_id)throw new DeveloperAccessError('idempotency_conflict','This purchase ID was already used for different data.',409)
 return {purchase}
}
export async function removeDeveloperPurchase(context:OperationContext,id:string) {
 const {error}=await createAdminClient().from('show_purchases').delete().eq('owner_user_id',context.ownerUserId).eq('client_id',id)
 if(error)throw new Error('Show purchase could not be removed')
 return {removed:true}
}
