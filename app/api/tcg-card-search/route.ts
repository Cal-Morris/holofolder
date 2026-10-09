import { NextRequest, NextResponse } from "next/server"
import { searchMirroredCards, type MirrorLanguage } from "@/lib/tcg-mirror"
import { PUBLIC_JSON_CACHE_HEADERS } from "@/lib/http-cache"

export const instant = false

const SUPPORTED_LANGUAGES = new Set<MirrorLanguage>(["en", "fr", "de", "es", "it", "pt-br", "ja", "ko"])

function normalizeLanguage(value: string | null): MirrorLanguage {
  const normalized = value?.trim().toLowerCase()
  return normalized && SUPPORTED_LANGUAGES.has(normalized as MirrorLanguage)
    ? normalized as MirrorLanguage
    : "en"
}

/** GET /api/tcg-card-search?q=bulbasaur%2044 → { cards: SearchCardResult[] } */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = (searchParams.get("q") ?? "").slice(0, 80)
  const language = normalizeLanguage(searchParams.get("language"))

  try {
    const cards = await searchMirroredCards(query, language)
    return NextResponse.json({ cards }, { headers: PUBLIC_JSON_CACHE_HEADERS })
  } catch (error) {
    console.error("[binderdex] Card search failed:", error)
    return NextResponse.json({ error: "Card search is unavailable right now.", cards: [] }, { status: 500 })
  }
}
