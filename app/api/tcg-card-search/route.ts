import { NextRequest, NextResponse } from "next/server"
import { searchMirroredCards } from "@/lib/tcg-mirror"
import { normalizeCardLanguage } from "@/lib/domain/cards"
import { PUBLIC_JSON_CACHE_HEADERS } from "@/lib/http-cache"

export const instant = false

/** GET /app/api/tcg-card-search?q=bulbasaur%2044 → { cards: SearchCardResult[] } */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = (searchParams.get("q") ?? "").slice(0, 80)
  const language = normalizeCardLanguage(searchParams.get("language"))

  try {
    const result = await searchMirroredCards(query, language)
    return NextResponse.json(result, { headers: PUBLIC_JSON_CACHE_HEADERS })
  } catch (error) {
    console.error("[holofolder] Card search failed:", error)
    return NextResponse.json({ error: "Card search is unavailable right now.", cards: [] }, { status: 500 })
  }
}
