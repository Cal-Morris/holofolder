import { NextRequest, NextResponse } from "next/server"
import { SAVED_PRICE_SUMMARY_MAX_CARDS, loadSavedCardPrices, loadDisplayFxRates, normalizeCardPriceLookups, refreshCardPriceLookups } from "@/lib/card-pricing"

const MAX_CARD_IDS = 200

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => null)
    const requestedCards: unknown[] = Array.isArray(payload?.cards)
      ? payload.cards
      : Array.isArray(payload?.cardIds)
        ? payload.cardIds
        : []
    const lookups = normalizeCardPriceLookups(requestedCards).slice(0, MAX_CARD_IDS)
    const force = payload?.force === true

    if (lookups.length === 0) {
      return NextResponse.json({ prices: [] })
    }

    const [result, fx] = await Promise.all([
      refreshCardPriceLookups(lookups, { force }),
      loadDisplayFxRates(),
    ])
    // Older clients send batches of 200; keep their quotes below the response-size limit.
    const prices = lookups.length <= 25 ? result.prices : result.prices.map(price => ({ ...price,
      historyPoints: undefined,
    }))
    return NextResponse.json({ prices, fx })
  } catch (error) {
    console.error("[holofolder] Failed to load card prices:", error)
    return NextResponse.json({ error: "Failed to load card prices." }, { status: 500 })
  }
}

/** Download existing evidence without provider calls. Full evidence (with history) allows 25 cards;
 * `fields=summary` returns only SAVED_PRICE_SUMMARY_COLUMNS and allows SAVED_PRICE_SUMMARY_MAX_CARDS. */
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" }
  try {
    const cards = JSON.parse(request.nextUrl.searchParams.get("cards") ?? "[]")
    const summary = request.nextUrl.searchParams.get("fields") === "summary"
    const max = summary ? SAVED_PRICE_SUMMARY_MAX_CARDS : 25
    if (!Array.isArray(cards) || cards.length > max) return NextResponse.json({ error: `Request at most ${max} cards.` }, { status: 400, headers })
    const prices = await loadSavedCardPrices(normalizeCardPriceLookups(cards), { summary })
    return NextResponse.json({ prices }, { headers })
  } catch {
    return NextResponse.json({ error: "Saved prices are unavailable." }, { status: 503, headers })
  }
}
