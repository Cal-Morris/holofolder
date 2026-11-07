import { NextRequest, NextResponse } from "next/server"
import { getMirroredCardsByIllustrator, getMirroredIllustratorDirectory } from "@/lib/tcg-mirror"
import { normalizeCardLanguage } from "@/lib/domain/cards"
import { cleanIllustratorName } from "@/lib/illustrators"
import { PUBLIC_JSON_CACHE_HEADERS } from "@/lib/http-cache"

export const instant = false

/**
 * GET /api/tcg-illustrators → { illustrators: [{ name, cardCount }] } (the whole directory, for search)
 * GET /api/tcg-illustrators?name=Mitsuhiro%20Arita&language=en → { illustrator, cards }
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const hasName = searchParams.has("name")
  const name = cleanIllustratorName(searchParams.get("name"))

  if (hasName && !name) {
    return NextResponse.json({ error: "name must not be empty" }, { status: 400 })
  }

  try {
    if (name) {
      const language = normalizeCardLanguage(searchParams.get("language"))
      const cards = await getMirroredCardsByIllustrator(name, language)
      return NextResponse.json({ illustrator: name, cards }, { headers: PUBLIC_JSON_CACHE_HEADERS })
    }

    const illustrators = await getMirroredIllustratorDirectory()
    return NextResponse.json({ illustrators }, { headers: PUBLIC_JSON_CACHE_HEADERS })
  } catch (error) {
    console.error("[holofolder] Illustrator lookup failed:", error)
    return NextResponse.json({ error: "Illustrator data is unavailable right now." }, { status: 500 })
  }
}
