import { createAdminClient } from "@/lib/supabase/admin"

export async function readDeveloperPriceHistory(input: Record<string, unknown>) {
  const {decodePage,encodeCursor}=await import('@/lib/developer-api/pagination')
  const {DeveloperAccessError}=await import('@/lib/developer-api/permissions')
  const params=new URLSearchParams(Object.entries(input).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]))
  const page=decodePage(params)
  let query=createAdminClient().from('card_price_history').select('card_id,language,finish,variant_key,source,observed_day,recorded_at,gbp_amount,confidence,source_updated_at').eq('card_id',String(input.id)).eq('language',String(input.language??'en')).order('observed_day',{ascending:false}).order('source').order('variant_key').limit(page.limit+1)
  if(page.after) {
    let tuple:unknown
    try{tuple=JSON.parse(page.after)}catch{throw new DeveloperAccessError('invalid_pagination','Use the cursor returned by this history query.',400)}
    if(!Array.isArray(tuple)||tuple.length!==3||!/^\d{4}-\d{2}-\d{2}$/.test(tuple[0])||!['tcgplayer','cardmarket','pokepulse'].includes(tuple[1])||typeof tuple[2]!=='string'||tuple[2].length>100)throw new DeveloperAccessError('invalid_pagination','Use the cursor returned by this history query.',400)
    const [day,source,variant]=tuple.map(x=>JSON.stringify(x))
    query=query.or(`observed_day.lt.${day},and(observed_day.eq.${day},source.gt.${source}),and(observed_day.eq.${day},source.eq.${source},variant_key.gt.${variant})`)
  }
  const {data,error}=await query
  if(error)throw new Error('Price history unavailable')
  const rows=data??[],last=rows[page.limit-1]
  return {data:rows.slice(0,page.limit),nextCursor:rows.length>page.limit?encodeCursor(JSON.stringify([last.observed_day,last.source,last.variant_key]),params):null}
}
