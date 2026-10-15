import { NextRequest, NextResponse } from "next/server"
import { loadDisplayFxRates, normalizeCardPriceLookups, refreshCardPriceLookups } from "@/lib/card-pricing"

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
    return NextResponse.json({ prices: result.prices, fx })
  } catch (error) {
    console.error("[binderdex] Failed to load card prices:", error)
    return NextResponse.json({ error: "Failed to load card prices." }, { status: 500 })
  }
}
