import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import { readStorageAuthority } from "@/lib/legacy-binder-transition"
import type { User } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { legacyAnalyticsEntries, parseAnalyticsQuery } from "@/lib/collection-analytics"

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
const missingHistory = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205"

/** History is owner-wide, so mixed authority cannot expose a frozen subset as current analytics. */
async function legacyAnalyticsAuthority(client: ReturnType<typeof createAdminClient>, ownerId: string) {
  const authority = await fetchAllRows((from, to) => client.from("storage_collection_state")
    .select("collection_id,authority,conversion_version").eq("owner_user_id", ownerId).order("collection_id").range(from, to))
  if (authority.error) readStorageAuthority(null, authority.error as { code?: string })
  else if (authority.data.some(row => readStorageAuthority(row, null) === "slots")) {
    return json({ error: "Native collection analytics are not enabled. Frozen legacy history is excluded.", code: "native_analytics_staged" }, 503)
  }
  return null
}

export async function readCollectionAnalytics(request: Request, user: Pick<User, "id">, verifiedOwnerId?:string) {
  try {
    const client = createAdminClient()
    if (!user) return json({ error: "Not authenticated" }, 401)
    let query
    try { query = parseAnalyticsQuery(new URL(request.url).searchParams) }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid history request" }, 400) }
    const ownerId = verifiedOwnerId ?? await resolveCollectionOwnerUserId(client, user.id)
    const authorityResponse = await legacyAnalyticsAuthority(client, ownerId)
    if (authorityResponse) return authorityResponse
    let activityQuery = client.from("collection_activity").select("id,pokemon_id,pokemon_name,recorded_at,before_state,after_state,changes").eq("owner_user_id", ownerId).order("id", { ascending: false }).limit(51)
    if (query.beforeId) activityQuery = activityQuery.lt("id", query.beforeId)
    const [initialActivityResult, priceResult] = await Promise.all([
      activityQuery,
      query.cardId ? client.from("card_price_history").select("card_id,language,finish,variant_key,source,observed_day,recorded_at,gbp_amount,confidence,source_updated_at").eq("card_id", query.cardId).eq("language", query.language).gte("observed_day", new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10)).order("observed_day", { ascending: true }).limit(5000) : Promise.resolve({ data: [], error: null }),
    ])
    let activityResult = initialActivityResult
    if (activityResult.error?.code === "42703" || activityResult.error?.code === "PGRST204") {
      let legacyQuery = client.from("collection_activity").select("id,pokemon_id,pokemon_name,recorded_at,before_state,after_state").eq("owner_user_id",ownerId).order("id",{ascending:false}).limit(51)
      if (query.beforeId) legacyQuery = legacyQuery.lt("id",query.beforeId)
      activityResult = await legacyQuery as typeof activityResult
    }
    if (missingHistory(activityResult.error) || missingHistory(priceResult.error)) return json({ activity: [], nextCursor: null, priceHistory: [], historyAvailable: false })
    if (activityResult.error || priceResult.error) return json({ error: "History could not be loaded" }, 503)
    const finalAuthorityResponse = await legacyAnalyticsAuthority(client, ownerId)
    if (finalAuthorityResponse) return finalAuthorityResponse
    const rows = activityResult.data ?? []
    return json({ activity: rows.slice(0, 50).flatMap(row => legacyAnalyticsEntries(row)), nextCursor: rows.length > 50 ? String(rows[49].id) : null, priceHistory: priceResult.data ?? [], historyAvailable: true })
  } catch { return json({ error: "History could not be loaded" }, 503) }
}

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
