import { NextRequest, NextResponse } from "next/server"
import { searchMirroredSets, getMirroredSetDexSlots, getRecentMirroredSets, getBrowsableMirroredSets } from "@/lib/tcg-mirror"
import { normalizeCardLanguage } from "@/lib/domain/cards"
import { POKEMON_CATALOG } from "@/lib/pokemon-catalog"
import { SET_SEARCH_RESULT_LIMIT } from "@/lib/tcg-set-slots"
import { PUBLIC_JSON_CACHE_HEADERS } from "@/lib/http-cache"

export const instant = false

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  try {
    if (searchParams.get("all") === "1") {
      return NextResponse.json({ sets: await getBrowsableMirroredSets(), selectedSet: null, slots: [] }, { headers: PUBLIC_JSON_CACHE_HEADERS })
    }

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
    const language = normalizeCardLanguage(searchParams.get("language"))
    const pokemonNames = new Map(POKEMON_CATALOG.map((pokemon) => [pokemon.id, pokemon.name] as const))
    const sets = query.length >= 2 || requestedSetId
      ? await searchMirroredSets(requestedSetId || query, requestedSetId ? 12 : SET_SEARCH_RESULT_LIMIT)
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

    const { selectedSet, slots, cards } = await getMirroredSetDexSlots(selectedSetId, language, pokemonNames)
    const allSets = sets.some((set) => set.id === selectedSetId) || !selectedSet
      ? sets
      : [selectedSet, ...sets]

    return NextResponse.json(
      {
        sets: allSets,
        selectedSet,
        slots,
        cards,
      },
      { headers: PUBLIC_JSON_CACHE_HEADERS },
    )
  } catch (error) {
    console.error("[holofolder] Failed to load TCG set slot coverage:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load set slot coverage." },
      { status: 500 },
    )
  }
}
