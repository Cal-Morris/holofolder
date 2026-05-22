import { NextRequest, NextResponse } from "next/server"
import { normalizeCardPriceLookups, refreshCardPriceLookups } from "@/lib/card-pricing"

export const runtime = "nodejs"

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

    if (lookups.length === 0) {
      return NextResponse.json({ prices: [] })
    }

    const result = await refreshCardPriceLookups(lookups)
    return NextResponse.json({ prices: result.prices })
  } catch (error) {
    console.error("[binderdex] Failed to load card prices:", error)
    return NextResponse.json({ error: "Failed to load card prices." }, { status: 500 })
  }
}
