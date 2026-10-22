import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isSlotStatus, normalizeCardFinish, normalizeCardLanguage } from "@/lib/domain/cards"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { normalizeCollectionItem } from "@/lib/collection/normalize"
import { collectionFingerprint } from "@/lib/collection/sync"
import { scopeCollectionQuery } from "@/lib/collection/load"
import { BinderAccessError, resolveWriteBinderId } from "@/lib/server/binders"

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

async function resolveOwnerUserId(userId: string) {
  return resolveCollectionOwnerUserId(createAdminClient(), userId)
}

/**
 * Compare-and-set for offline edits: when the client says which row its edit was based on, refuse the write
 * (409 + current row) if the row has changed since. Without a base fingerprint, writes behave as before.
 */
async function checkBaseFingerprint(
  admin: ReturnType<typeof createAdminClient>,
  ownerUserId: string,
  binderId: string | null,
  pokemonId: number,
  baseFingerprint: unknown,
) {
  if (typeof baseFingerprint !== "string" || baseFingerprint.length === 0) return null

  const { data, error } = await scopeCollectionQuery(admin.from("pokemon_collection").select("*"), ownerUserId, binderId)
    .eq("pokemon_id", pokemonId)
    .maybeSingle()

  if (error) throw error
  const current = data ? normalizeCollectionItem(data) : null
  if (collectionFingerprint(current) === baseFingerprint) return null

  return NextResponse.json({ error: "Collection item changed on the server", item: data ?? null }, { status: 409 })
}

/** The binder this request writes to (the owner's default when none is named); a 404 response for someone else's. */
async function resolveBinder(admin: ReturnType<typeof createAdminClient>, ownerUserId: string, requested: unknown) {
  try {
    return { binderId: await resolveWriteBinderId(admin, ownerUserId, requested) }
  } catch (error) {
    if (error instanceof BinderAccessError) {
      return { response: NextResponse.json({ error: "Binder not found" }, { status: 404 }) }
    }
    throw error
  }
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

    if (!isSlotStatus(status)) {
      return NextResponse.json({ error: "Invalid collection status" }, { status: 400 })
    }

    const ownerUserId = await resolveOwnerUserId(user.id)
    const admin = createAdminClient()
    const binder = await resolveBinder(admin, ownerUserId, body?.binderId)
    if (binder.response) return binder.response
    const { binderId } = binder
    const conflict = await checkBaseFingerprint(admin, ownerUserId, binderId, pokemonId, body?.baseFingerprint)
    if (conflict) return conflict

    const { data, error } = await admin
      .from("pokemon_collection")
      .upsert(
        {
          user_id: ownerUserId,
          ...(binderId ? { binder_id: binderId } : {}),
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
        { onConflict: "binder_id,pokemon_id" },
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

    if (!isSlotStatus(status)) {
      return NextResponse.json({ error: "Invalid collection status" }, { status: 400 })
    }

    const ownerUserId = await resolveOwnerUserId(user.id)
    const admin = createAdminClient()
    const binder = await resolveBinder(admin, ownerUserId, body?.binderId)
    if (binder.response) return binder.response
    const { data, error } = await scopeCollectionQuery(admin.from("pokemon_collection").update({ status }), ownerUserId, binder.binderId)
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

    const ownerUserId = await resolveOwnerUserId(user.id)
    const admin = createAdminClient()
    const binder = await resolveBinder(admin, ownerUserId, request.nextUrl.searchParams.get("binderId"))
    if (binder.response) return binder.response
    const conflict = await checkBaseFingerprint(admin, ownerUserId, binder.binderId, pokemonId, request.nextUrl.searchParams.get("baseFingerprint"))
    if (conflict) return conflict

    const { error } = await scopeCollectionQuery(admin.from("pokemon_collection").delete(), ownerUserId, binder.binderId)
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
