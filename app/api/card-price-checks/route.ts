import { isPriceCheckCardId } from "@/lib/card-catalog"
import { createClient } from "@/lib/supabase/server"
import { getSessionUser } from "@/lib/supabase/session-user"
import { loadCardPriceChecks } from "@/lib/server/card-price-checks"

const headers = { "Cache-Control": "no-store" }
async function handle(request: Request, refresh: boolean) {
  try {
    const url = new URL(request.url)
    if (refresh && request.headers.get("origin") && request.headers.get("origin") !== url.origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers })
    const client = await createClient()
    const user = refresh ? (await client.auth.getUser()).data.user : await getSessionUser(client)
    if (!user) return Response.json({ error: "Sign in to check prices." }, { status: 401, headers })
    const cardId = url.searchParams.get("cardId") ?? ""
    const finish = url.searchParams.get("finish") ?? "any"
    const source = url.searchParams.get("source")
    if (source !== null && source !== "ebay" && source !== "soldcomps") return Response.json({ error: "Invalid price source." }, { status: 400, headers })
    if (!isPriceCheckCardId(cardId) || !["normal", "holo", "reverse_holo", "any"].includes(finish)) return Response.json({ error: "Invalid card or finish." }, { status: 400, headers })
    if ((url.searchParams.get("language") ?? "en") !== "en") return Response.json({ error: "Price comparisons currently support English cards only." }, { status: 422, headers })
    const result = await loadCardPriceChecks(cardId, finish, refresh, source ?? undefined)
    return Response.json(result ?? { error: "This exact printing is not supported yet." }, { status: result ? 200 : 422, headers })
  } catch {
    return Response.json({ error: "Saved price checks are temporarily unavailable." }, { status: 503, headers })
  }
}
export async function GET(request: Request) { return handle(request, false) }
export async function POST(request: Request) { return handle(request, true) }
