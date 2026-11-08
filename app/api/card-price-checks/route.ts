import { requirePaidAccess, billingErrorResponse } from "@/lib/server/billing"
import { isBillingError } from "@/lib/billing"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { requireAppearanceOrigin } from "@/lib/server/binder-appearance"
import { isPriceCheckCardId } from "@/lib/card-catalog"
import { createClient } from "@/lib/supabase/server"
import { getSessionUser } from "@/lib/supabase/session-user"
import { normalizeComparisonTargets } from "@/lib/comparison-jobs"
import { loadCardPriceChecks, loadSavedCardPriceChecks } from "@/lib/server/card-price-checks"

const headers = { "Cache-Control": "no-store" }
async function handle(request: Request, refresh: boolean) {
  try {
    const url = new URL(request.url)
    if (refresh) requireAppearanceOrigin(request)
    const client = await createClient()
    const user = refresh ? (await client.auth.getUser()).data.user : await getSessionUser(client)
    if (!user) return Response.json({ error: "Sign in to check prices." }, { status: 401, headers })
    await requirePaidAccess(await resolveCollectionOwnerUserId(client, user.id))
    if (!refresh && url.searchParams.has("cards")) {
      let cards
      try { cards = normalizeComparisonTargets(JSON.parse(url.searchParams.get("cards")!)) } catch { cards = null }
      if (!cards || cards.length > 25) return Response.json({ error: "Invalid saved-check batch." }, { status: 400, headers })
      return Response.json({ checks: await loadSavedCardPriceChecks(cards) }, { headers })
    }
    const cardId = url.searchParams.get("cardId") ?? ""
    const finish = url.searchParams.get("finish") ?? "any"
    const source = url.searchParams.get("source")
    if (source !== null && source !== "ebay" && source !== "soldcomps") return Response.json({ error: "Invalid price source." }, { status: 400, headers })
    if (!isPriceCheckCardId(cardId) || !["normal", "holo", "reverse_holo", "any"].includes(finish)) return Response.json({ error: "Invalid card or finish." }, { status: 400, headers })
    if ((url.searchParams.get("language") ?? "en") !== "en") return Response.json({ error: "Price comparisons currently support English cards only." }, { status: 422, headers })
    const result = await loadCardPriceChecks(cardId, finish, refresh, source ?? undefined, refresh && url.searchParams.get("refresh") === "true")
    return Response.json(result ?? { error: "This exact printing is not supported yet." }, { status: result ? 200 : 422, headers })
  } catch (error) {
    if (isBillingError(error)) return billingErrorResponse(error)
    return Response.json({ error: "Saved price checks are temporarily unavailable." }, { status: 503, headers })
  }
}
export async function GET(request: Request) { return handle(request, false) }
export async function POST(request: Request) { return handle(request, true) }
