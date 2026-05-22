import { NextRequest, NextResponse } from "next/server"
import { getMirroredCardsForPokemon, type MirrorLanguage } from "@/lib/tcg-mirror"

export const runtime = "nodejs"

const SUPPORTED_LANGUAGES = new Set<MirrorLanguage>(["en", "fr", "de", "es", "it", "pt-br", "ja", "ko"])

function normalizeLanguage(value: string | null): MirrorLanguage {
  const normalized = value?.trim().toLowerCase()
  return normalized && SUPPORTED_LANGUAGES.has(normalized as MirrorLanguage)
    ? normalized as MirrorLanguage
    : "en"
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const pokemonId = Number.parseInt(searchParams.get("pokemonId") || "", 10)
    const language = normalizeLanguage(searchParams.get("language"))

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
