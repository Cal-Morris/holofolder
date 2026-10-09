import { NextRequest, NextResponse } from "next/server"
import { searchMirroredSets, getMirroredSetDexSlots, getRecentMirroredSets, type MirrorLanguage } from "@/lib/tcg-mirror"
import { POKEMON_CATALOG } from "@/lib/pokemon-catalog"
import { PUBLIC_JSON_CACHE_HEADERS } from "@/lib/http-cache"

export const instant = false

const SUPPORTED_LANGUAGES = new Set<MirrorLanguage>(["en", "fr", "de", "es", "it", "pt-br", "ja", "ko"])

function normalizeLanguage(value: string | null): MirrorLanguage {
  const normalized = value?.trim().toLowerCase()
  return normalized && SUPPORTED_LANGUAGES.has(normalized as MirrorLanguage)
    ? normalized as MirrorLanguage
    : "en"
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  try {
    if (searchParams.get("recent") === "1") {
      const asOfDate = new Date().toISOString().slice(0, 10)
      const recentSets = await getRecentMirroredSets(asOfDate, 6)

      return NextResponse.json(
        {
          sets: recentSets,
          selectedSet: null,
          slots: [],
        },
        { headers: PUBLIC_JSON_CACHE_HEADERS },
      )
    }

    const query = searchParams.get("query")?.trim() ?? ""
    const requestedSetId = searchParams.get("setId")?.trim() ?? ""
    const language = normalizeLanguage(searchParams.get("language"))
    const pokemonNames = new Map(POKEMON_CATALOG.map((pokemon) => [pokemon.id, pokemon.name] as const))
    const sets = query.length >= 2 || requestedSetId
      ? await searchMirroredSets(requestedSetId || query, requestedSetId ? 12 : 8)
      : []
    const selectedSetId = requestedSetId || null

    if (!selectedSetId) {
      return NextResponse.json(
        {
          sets,
          selectedSet: null,
          slots: [],
        },
        { headers: PUBLIC_JSON_CACHE_HEADERS },
      )
    }

    const { selectedSet, slots } = await getMirroredSetDexSlots(selectedSetId, language, pokemonNames)
    const allSets = sets.some((set) => set.id === selectedSetId) || !selectedSet
      ? sets
      : [selectedSet, ...sets]

    return NextResponse.json(
      {
        sets: allSets,
        selectedSet,
        slots,
      },
      { headers: PUBLIC_JSON_CACHE_HEADERS },
    )
  } catch (error) {
    console.error("[binderdex] Failed to load TCG set slot coverage:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load set slot coverage." },
      { status: 500 },
    )
  }
}
