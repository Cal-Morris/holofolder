import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

const VALID_STATUSES = new Set(["collected", "finalized", "considering", "wishlisted"])
const VALID_CARD_LANGUAGES = new Set(["en", "fr", "de", "es", "it", "pt-br", "ja", "ko"])
const VALID_CARD_FINISHES = new Set([
  "normal",
  "holo",
  "reverse_holo",
  "double_rare",
  "ultra_rare",
  "illustration_rare",
  "special_illustration_rare",
  "secret_rare",
  "hyper_rare",
  "radiant_rare",
  "ace_spec",
  "amazing_rare",
  "shiny_rare",
  "jumbo",
])

function normalizeCardLanguage(value: unknown) {
  if (typeof value !== "string") return "en"
  const normalized = value.trim().toLowerCase()
  return VALID_CARD_LANGUAGES.has(normalized) ? normalized : "en"
}

function normalizeCardFinish(value: unknown) {
  return typeof value === "string" && VALID_CARD_FINISHES.has(value) ? value : "normal"
}

function normalizeWantedCards(value: unknown) {
  if (!Array.isArray(value)) return []

  return value.flatMap((rawCard) => {
    if (!rawCard || typeof rawCard !== "object") return []
    const card = rawCard as Record<string, unknown>
    if (typeof card.card_id !== "string" || typeof card.card_name !== "string") return []

    return [{
      card_id: card.card_id,
      card_name: card.card_name,
      card_image: typeof card.card_image === "string" ? card.card_image : null,
      card_set: typeof card.card_set === "string" ? card.card_set : null,
      card_language: normalizeCardLanguage(card.card_language),
      card_finish: normalizeCardFinish(card.card_finish),
      rarity: typeof card.rarity === "string" ? card.rarity : null,
      local_id: typeof card.local_id === "string" ? card.local_id : null,
      set_total: typeof card.set_total === "number" && Number.isFinite(card.set_total) ? card.set_total : null,
      added_at: typeof card.added_at === "string" ? card.added_at : new Date().toISOString(),
    }]
  })
}

async function resolveCollectionOwnerUserId(userId: string) {
  const admin = createAdminClient()
  const { data: partnership, error } = await admin
    .from("partnerships")
    .select("owner_user_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return partnership?.owner_user_id || userId
}

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  return user
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const pokemonId = Number(body?.pokemonId)
    const pokemonName = typeof body?.pokemonName === "string" ? body.pokemonName : ""
    const status = typeof body?.status === "string" ? body.status : "collected"

    if (!Number.isInteger(pokemonId) || pokemonId <= 0 || !pokemonName) {
      return NextResponse.json({ error: "pokemonId and pokemonName are required" }, { status: 400 })
    }

    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid collection status" }, { status: 400 })
    }

    const ownerUserId = await resolveCollectionOwnerUserId(user.id)
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("pokemon_collection")
      .upsert(
        {
          user_id: ownerUserId,
          pokemon_id: pokemonId,
          pokemon_name: pokemonName,
          card_id: typeof body?.cardId === "string" ? body.cardId : null,
          card_name: typeof body?.cardName === "string" ? body.cardName : null,
          card_image: typeof body?.cardImage === "string" ? body.cardImage : null,
          card_set: typeof body?.cardSet === "string" ? body.cardSet : null,
          card_language: normalizeCardLanguage(body?.cardLanguage),
          card_finish: normalizeCardFinish(body?.cardFinish),
          wanted_cards: normalizeWantedCards(body?.wantedCards),
          status,
        },
        { onConflict: "user_id,pokemon_id" },
      )
      .select("*")
      .single()

    if (error) {
      console.error("[binderdex] API collection upsert failed:", error)
      return NextResponse.json({ error: error.message || "Failed to save collection item" }, { status: 500 })
    }

    return NextResponse.json({ item: data })
  } catch (error) {
    console.error("[binderdex] API collection POST failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save collection item" },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const pokemonId = Number(body?.pokemonId)
    const status = typeof body?.status === "string" ? body.status : ""

    if (!Number.isInteger(pokemonId) || pokemonId <= 0) {
      return NextResponse.json({ error: "pokemonId is required" }, { status: 400 })
    }

    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid collection status" }, { status: 400 })
    }

    const ownerUserId = await resolveCollectionOwnerUserId(user.id)
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("pokemon_collection")
      .update({ status })
      .eq("user_id", ownerUserId)
      .eq("pokemon_id", pokemonId)
      .select("*")
      .single()

    if (error) {
      console.error("[binderdex] API collection status update failed:", error)
      return NextResponse.json({ error: error.message || "Failed to update collection item" }, { status: 500 })
    }

    return NextResponse.json({ item: data })
  } catch (error) {
    console.error("[binderdex] API collection PATCH failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update collection item" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const pokemonId = Number(request.nextUrl.searchParams.get("pokemonId"))
    if (!Number.isInteger(pokemonId) || pokemonId <= 0) {
      return NextResponse.json({ error: "pokemonId is required" }, { status: 400 })
    }

    const ownerUserId = await resolveCollectionOwnerUserId(user.id)
    const admin = createAdminClient()
    const { error } = await admin
      .from("pokemon_collection")
      .delete()
      .eq("user_id", ownerUserId)
      .eq("pokemon_id", pokemonId)

    if (error) {
      console.error("[binderdex] API collection delete failed:", error)
      return NextResponse.json({ error: error.message || "Failed to delete collection item" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[binderdex] API collection DELETE failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete collection item" },
      { status: 500 },
    )
  }
}
