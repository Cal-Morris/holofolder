import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { parseAnalyticsQuery } from "@/lib/collection-analytics"

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
const missingHistory = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205"

export async function GET(request: Request) {
  try {
    const client = await createClient()
    const { data: { user } } = await client.auth.getUser()
    if (!user) return json({ error: "Not authenticated" }, 401)
    let query
    try { query = parseAnalyticsQuery(new URL(request.url).searchParams) }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid history request" }, 400) }
    const ownerId = await resolveCollectionOwnerUserId(client, user.id)
    let activityQuery = client.from("collection_activity").select("id,pokemon_id,pokemon_name,recorded_at,before_state,after_state").eq("owner_user_id", ownerId).order("id", { ascending: false }).limit(51)
    if (query.beforeId) activityQuery = activityQuery.lt("id", query.beforeId)
    const [activityResult, priceResult] = await Promise.all([
      activityQuery,
      query.cardId ? client.from("card_price_history").select("card_id,language,finish,variant_key,source,observed_day,recorded_at,gbp_amount,confidence,source_updated_at").eq("card_id", query.cardId).eq("language", query.language).gte("observed_day", new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10)).order("observed_day", { ascending: true }).limit(5000) : Promise.resolve({ data: [], error: null }),
    ])
    if (missingHistory(activityResult.error) || missingHistory(priceResult.error)) return json({ activity: [], nextCursor: null, priceHistory: [], historyAvailable: false })
    if (activityResult.error || priceResult.error) return json({ error: "History could not be loaded" }, 503)
    const rows = activityResult.data ?? []
    return json({ activity: rows.slice(0, 50).map(row => ({ ...row, id: String(row.id) })), nextCursor: rows.length > 50 ? String(rows[49].id) : null, priceHistory: priceResult.data ?? [], historyAvailable: true })
  } catch { return json({ error: "History could not be loaded" }, 503) }
}
