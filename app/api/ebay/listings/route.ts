import { isPriceCheckCardId } from "@/lib/card-catalog"
import { createClient } from "@/lib/supabase/server"
import { getSessionUser } from "@/lib/supabase/session-user"
import { loadEbayListingIndicator } from "@/lib/server/ebay-listings"

const headers = { "Cache-Control": "no-store" }

export async function GET(request: Request) {
  try {
    if (!await getSessionUser(await createClient())) return Response.json({ error: "Sign in to check eBay listings." }, { status: 401, headers })
    const params = new URL(request.url).searchParams
    const cardId = params.get("cardId") ?? ""
    const finish = params.get("finish")
    if (!isPriceCheckCardId(cardId) || (finish && !["normal", "holo", "reverse_holo"].includes(finish))) {
      return Response.json({ error: "Invalid card or finish." }, { status: 400, headers })
    }
    if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) return Response.json({ error: "eBay listings are unavailable." }, { status: 503, headers })
    const result = await loadEbayListingIndicator(cardId, finish === "reverse_holo" ? "reverse" : finish === "normal" || finish === "holo" ? finish : null)
    return Response.json(result ?? { error: "This exact printing is not supported by the listing lookup yet." }, { status: result ? 200 : 422, headers })
  } catch (error) {
    console.warn("[holofolder] eBay listings unavailable:", error instanceof Error ? error.message : "Unknown error")
    return Response.json({ error: "eBay listings are temporarily unavailable. Try again later." }, { status: 503, headers })
  }
}
