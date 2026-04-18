import { NextRequest, NextResponse } from "next/server"
import { getMirroredCardsForPokemon } from "@/lib/tcg-mirror"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const pokemonId = Number.parseInt(searchParams.get("pokemonId") || "", 10)
    const languageParam = searchParams.get("language")
    const language = languageParam === "ja" ? "ja" : "en"

    if (!Number.isInteger(pokemonId) || pokemonId < 1) {
      return NextResponse.json({ error: "pokemonId must be a positive integer" }, { status: 400 })
    }

    const cards = await getMirroredCardsForPokemon(pokemonId, language)

    return NextResponse.json({
      cards,
      source: "mirror",
    })
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
