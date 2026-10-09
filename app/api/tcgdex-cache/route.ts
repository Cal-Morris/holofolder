import { NextRequest, NextResponse } from "next/server"
import { getMirroredCardsForPokemon } from "@/lib/tcg-mirror"
import { normalizeCardLanguage } from "@/lib/domain/cards"
import { PUBLIC_JSON_CACHE_HEADERS } from "@/lib/http-cache"

export const instant = false

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  try {
    const pokemonId = Number.parseInt(searchParams.get("pokemonId") || "", 10)
    const language = normalizeCardLanguage(searchParams.get("language"))

    if (!Number.isInteger(pokemonId) || pokemonId < 1) {
      return NextResponse.json({ error: "pokemonId must be a positive integer" }, { status: 400 })
    }

    const cards = await getMirroredCardsForPokemon(pokemonId, language)

    return NextResponse.json(
      {
        cards,
        source: "mirror",
      },
      { headers: PUBLIC_JSON_CACHE_HEADERS },
    )
  } catch (error) {
    console.error("[binderdex] Failed to load cached TCG cards:", error)
    return NextResponse.json(
      {
        error: "Failed to load mirrored cards. Run `bun sync-card-db` to seed the local mirror.",
      },
      { status: 500 },
    )
  }
}
