import { legacyWritePausedResponse } from "@/lib/server/legacy-write-fence"
import { recipientAccessErrorResponse } from "@/lib/server/collection-recipient"
import { legacySlotCompatibilityResponse, legacySlotAuthorityResponse } from "@/lib/server/operations/binder-slots"
import {normalizeStoredDeveloperImage} from '@/lib/developer-api/image-identity'
import {getR2Config,getR2BucketEndpoint} from '@/lib/card-image-r2'
import type { User } from "@supabase/supabase-js"
import { BillingAccessError, isBillingError } from "@/lib/billing"
import { scheduleCollectorTracking, recordCollectorSave } from "@/lib/server/collector-funnel"
import { billingErrorResponse } from "@/lib/server/billing"
import { notificationFirstName } from "@/lib/account-identity"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isSlotStatus, normalizeCardFinish, normalizeCardLanguage } from "@/lib/domain/cards"
import { assertCollectionWriteAccess, resolveCollectionMembership, resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import type { CollectedPokemon } from "@/lib/domain/cards"
import { normalizeAcquisition } from "@/lib/partner-push"
import { saveCollectionWithAcquisition, startPendingPartnerPush } from "@/lib/server/partner-push"
import { validateWantedPeople } from "@/lib/wanted-people"
import { normalizeCollectionItem } from "@/lib/collection/normalize"
import { matchesCollectionFingerprint } from "@/lib/collection/sync"
import { scopeCollectionQuery } from "@/lib/collection/load"
import { BinderAccessError, resolveWriteBinderId } from "@/lib/server/binders"

async function checkLegacyBinderAuthority(admin: ReturnType<typeof createAdminClient>, ownerUserId: string, binderId: string | null, strict = false) {
  if (!binderId) return null
  const { data, error } = await admin.from("storage_collection_state").select("authority,conversion_version")
    .eq("collection_id", binderId).eq("owner_user_id", ownerUserId).maybeSingle()
  if (strict && error) return NextResponse.json({ error: "The original binder authority is unavailable. Keep this change on this device.", code: "collection_recipient_inaccessible", retainOnDevice: true }, { status: 503 })
  return legacySlotAuthorityResponse(data, error)
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
  loadedItem?: CollectedPokemon | null,
  allowLegacyPeople = false,
) {
  if (typeof baseFingerprint !== "string" || baseFingerprint.length === 0) return null

  let current = loadedItem
  if (current === undefined) {
    const { data, error } = await scopeCollectionQuery(admin.from("pokemon_collection").select("*"), ownerUserId, binderId)
      .eq("pokemon_id", pokemonId).maybeSingle()
    if (error) throw error
    current = data ? normalizeCollectionItem(data) : null
  }
  if (matchesCollectionFingerprint(current, baseFingerprint, allowLegacyPeople)) return null

  return NextResponse.json({ error: "Collection item changed on the server", item: current ?? null }, { status: 409 })
}

/** The binder this request writes to (the owner's default when none is named); a 404 response for someone else's. */
async function resolveBinder(admin: ReturnType<typeof createAdminClient>, ownerUserId: string, requested: unknown, strict = false) {
  try {
    if (strict) {
      const { data, error } = await admin.from("binders").select("id").eq("id", requested).eq("owner_user_id", ownerUserId).maybeSingle()
      if (!requested || error || !data) return { response: NextResponse.json({ error: "The original binder is unavailable. Keep this change on this device.", code: "collection_recipient_inaccessible", retainOnDevice: true }, { status: 503 }) }
      return { binderId: String(requested) }
    }
    return { binderId: await resolveWriteBinderId(admin, ownerUserId, requested) }
  } catch (error) {
    if (error instanceof BinderAccessError) {
      return { response: NextResponse.json({ error: "Binder not found" }, { status: 404 }) }
    }
    throw error
  }
}


export async function saveCollectionItem(request: NextRequest, actor: User, requireAtomic = false, verifiedMembership?: {ownerUserId:string;memberIds:readonly string[]}) {
  try {
    const user = actor
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

    const admin = createAdminClient()
    await assertCollectionWriteAccess(admin, user.id, body?.binderId)
    const { ownerUserId, memberIds } = verifiedMembership ?? await resolveCollectionMembership(admin, user.id)
    const binder = await resolveBinder(admin, ownerUserId, body?.binderId, !!verifiedMembership && !requireAtomic)
    if (binder.response) return binder.response
    const { binderId } = binder
    const authority = await checkLegacyBinderAuthority(admin, ownerUserId, binderId, !!verifiedMembership && !requireAtomic)
    if (authority) return authority
    const { data: previousRow, error: previousError } = await scopeCollectionQuery(admin.from("pokemon_collection").select("*"), ownerUserId, binderId)
      .eq("pokemon_id", pokemonId).maybeSingle()
    if (previousError) throw previousError
    const previous = previousRow ? normalizeCollectionItem(previousRow) : null
    const hasPeopleMetadata = Array.isArray(body?.wantedCards) && body.wantedCards.some((card: unknown) => card && typeof card === "object" && Object.hasOwn(card, "wanted_by"))
    const conflict = await checkBaseFingerprint(admin, ownerUserId, binderId, pokemonId, body?.baseFingerprint, previous, body?.fingerprintVersion === undefined && !hasPeopleMetadata)
    if (conflict) return conflict
    let wantedCards
    try {
      wantedCards = validateWantedPeople(body?.wantedCards, previous?.wanted_cards ?? [], memberIds)
    } catch {
      return NextResponse.json({ error: "Invalid wanted assignment" }, { status: 400 })
    }

    const r2=requireAtomic?getR2Config():null
    const bases=r2?[r2.publicBaseUrl??getR2BucketEndpoint(r2),getR2BucketEndpoint(r2)]:[]
    if(requireAtomic)wantedCards=wantedCards.map(card=>({...card,...(card.card_image?{card_image:normalizeStoredDeveloperImage(card.card_image,bases)??undefined}:{})}))
    const row = {
          user_id: ownerUserId,
          ...(binderId ? { binder_id: binderId } : {}),
          pokemon_id: pokemonId,
          pokemon_name: pokemonName,
          card_id: typeof body?.cardId === "string" ? body.cardId : null,
          card_name: typeof body?.cardName === "string" ? body.cardName : null,
          card_image: requireAtomic?normalizeStoredDeveloperImage(body?.cardImage,bases):typeof body?.cardImage === "string" ? body.cardImage : null,
          card_set: typeof body?.cardSet === "string" ? body.cardSet : null,
          card_language: normalizeCardLanguage(body?.cardLanguage),
          card_finish: normalizeCardFinish(body?.cardFinish),
          wanted_cards: wantedCards,
          status,
        }
    const intent = normalizeAcquisition(body?.acquisition)
    const acquisition = intent?.actorId === user.id ? intent : undefined
    const atomic = await saveCollectionWithAcquisition({
      ownerId: ownerUserId, binderId, actorId: user.id,
      actorName: notificationFirstName(user.user_metadata),
      pokemonId, row, expected: previousRow ?? null, acquisition,
    })
    if ((requireAtomic || verifiedMembership) && !atomic) return NextResponse.json({ error: "Atomic collection writes are temporarily unavailable" }, { status: 503 })
    if (atomic?.conflict) {
      const { data: current } = await scopeCollectionQuery(admin.from("pokemon_collection").select("*"), ownerUserId, binderId).eq("pokemon_id", pokemonId).maybeSingle()
      return NextResponse.json({ error: "Collection item changed on the server", item: current ? normalizeCollectionItem(current) : null }, { status: 409 })
    }
    if (atomic) {
      if (acquisition) await startPendingPartnerPush(user.id).catch(() => undefined)
      const at = new Date().toISOString()
      scheduleCollectorTracking(() => recordCollectorSave(user.id, ownerUserId, body?.origin === "import" ? "import" : "manual", at))
      return NextResponse.json({ item: atomic.item })
    }
    const { data, error } = await admin.from("pokemon_collection").upsert(row, { onConflict: "binder_id,pokemon_id" }).select("*").single()

    const paused = legacyWritePausedResponse(error)
    if (paused) return paused
    if (isBillingError(error)) throw new BillingAccessError("card_limit_reached")
    if (error) {
      const compatibility = legacySlotCompatibilityResponse(error)
      if (compatibility) return compatibility
      console.error("[holofolder] API collection upsert failed:", error)
      return NextResponse.json({ error: error.message || "Failed to save collection item" }, { status: 500 })
    }

    const at = new Date().toISOString()
    scheduleCollectorTracking(() => recordCollectorSave(user.id, ownerUserId, body?.origin === "import" ? "import" : "manual", at))
    return NextResponse.json({ item: data })
  } catch (error) {
    const paused = legacyWritePausedResponse(error)
    if (paused) return paused
    const recipientFailure = (!!verifiedMembership && !requireAtomic) ? recipientAccessErrorResponse(error) : null
    if (recipientFailure) return recipientFailure
    const compatibility = legacySlotCompatibilityResponse(error)
    if (compatibility) return compatibility
    if (isBillingError(error)) return billingErrorResponse(error)
    console.error("[holofolder] API collection POST failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save collection item" },
      { status: 500 },
    )
  }
}

export async function updateCollectionStatus(request: NextRequest, actor: User, verifiedOwnerId?: string) {
  try {
    const user = actor
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

    const admin = createAdminClient()
    await assertCollectionWriteAccess(admin, user.id, body?.binderId)
    const ownerUserId = verifiedOwnerId ?? await resolveOwnerUserId(user.id)
    const binder = await resolveBinder(admin, ownerUserId, body?.binderId, !!verifiedOwnerId)
    if (binder.response) return binder.response
    const authority = await checkLegacyBinderAuthority(admin, ownerUserId, binder.binderId, !!verifiedOwnerId)
    if (authority) return authority
    if (verifiedOwnerId) {
      if (typeof body?.baseFingerprint !== "string" || !body.baseFingerprint.length)
        return NextResponse.json({ error: "The original status change needs its reviewed base. Keep it on this device.", code: "collection_precondition_required", retainOnDevice: true }, { status: 503 })
      const previous = await scopeCollectionQuery(admin.from("pokemon_collection").select("*"), ownerUserId, binder.binderId).eq("pokemon_id", pokemonId).maybeSingle()
      if (previous.error) throw previous.error
      const conflict = await checkBaseFingerprint(admin, ownerUserId, binder.binderId, pokemonId, body.baseFingerprint, previous.data ? normalizeCollectionItem(previous.data) : null, body.fingerprintVersion === undefined)
      if (conflict) return conflict
      if (!previous.data) return NextResponse.json({ error: "Collection item not found" }, { status: 404 })
      const atomic = await saveCollectionWithAcquisition({ ownerId: ownerUserId, binderId: binder.binderId, actorId: user.id,
        actorName: notificationFirstName(user.user_metadata), pokemonId, row: { ...previous.data, status }, expected: previous.data, acquisition: undefined })
      if (!atomic) return NextResponse.json({ error: "Atomic collection writes are temporarily unavailable", retainOnDevice: true }, { status: 503 })
      if (atomic.conflict) {
        const current = await scopeCollectionQuery(admin.from("pokemon_collection").select("*"), ownerUserId, binder.binderId).eq("pokemon_id", pokemonId).maybeSingle()
        if (current.error) throw current.error
        return NextResponse.json({ error: "Collection item changed on the server", item: current.data ? normalizeCollectionItem(current.data) : null }, { status: 409 })
      }
      const at = new Date().toISOString()
      scheduleCollectorTracking(() => recordCollectorSave(user.id, ownerUserId, "manual", at))
      return NextResponse.json({ item: atomic.item })
    }
    const { data, error } = await scopeCollectionQuery(admin.from("pokemon_collection").update({ status }), ownerUserId, binder.binderId)
      .eq("pokemon_id", pokemonId)
      .select("*")
      .single()

    if (error) {
      const paused = legacyWritePausedResponse(error)
      if (paused) return paused
      const compatibility = legacySlotCompatibilityResponse(error)
      if (compatibility) return compatibility
      console.error("[holofolder] API collection status update failed:", error)
      return NextResponse.json({ error: error.message || "Failed to update collection item" }, { status: 500 })
    }

    const at = new Date().toISOString()
    scheduleCollectorTracking(() => recordCollectorSave(user.id, ownerUserId, "manual", at))
    return NextResponse.json({ item: data })
  } catch (error) {
    const paused = legacyWritePausedResponse(error)
    if (paused) return paused
    const recipientFailure = (!!verifiedOwnerId) ? recipientAccessErrorResponse(error) : null
    if (recipientFailure) return recipientFailure
    const compatibility = legacySlotCompatibilityResponse(error)
    if (compatibility) return compatibility
    if (isBillingError(error)) return billingErrorResponse(error)
    console.error("[holofolder] API collection PATCH failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update collection item" },
      { status: 500 },
    )
  }
}

export async function deleteCollectionItem(request: NextRequest, actor: Pick<User, "id">, atomicDelete = false, verifiedOwnerId?:string, strictRecipient = false) {
  try {
    const user = actor
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const pokemonId = Number(request.nextUrl.searchParams.get("pokemonId"))
    if (!Number.isInteger(pokemonId) || pokemonId <= 0) {
      return NextResponse.json({ error: "pokemonId is required" }, { status: 400 })
    }

    const admin = createAdminClient()
    await assertCollectionWriteAccess(admin, user.id, request.nextUrl.searchParams.get("binderId"))
    const ownerUserId = verifiedOwnerId ?? await resolveOwnerUserId(user.id)
    const binder = await resolveBinder(admin, ownerUserId, request.nextUrl.searchParams.get("binderId"), strictRecipient || (!!verifiedOwnerId && !atomicDelete))
    if (binder.response) return binder.response
    const authority = await checkLegacyBinderAuthority(admin, ownerUserId, binder.binderId, strictRecipient || (!!verifiedOwnerId && !atomicDelete))
    if (authority) return authority
    const previous = atomicDelete
      ? await scopeCollectionQuery(admin.from("pokemon_collection").select("*"), ownerUserId, binder.binderId).eq("pokemon_id", pokemonId).maybeSingle()
      : undefined
    if (previous?.error) throw previous.error
    const conflict = await checkBaseFingerprint(admin, ownerUserId, binder.binderId, pokemonId, request.nextUrl.searchParams.get("baseFingerprint"), previous ? (previous.data ? normalizeCollectionItem(previous.data) : null) : undefined, !request.nextUrl.searchParams.has("fingerprintVersion"))
    if (conflict) return conflict

    const result = atomicDelete
      ? await admin.rpc("developer_delete_collection", { actor: actor.id, owner_id: ownerUserId, binder: binder.binderId, pokemon: pokemonId, expected: previous?.data ?? null })
      : await scopeCollectionQuery(admin.from("pokemon_collection").delete(), ownerUserId, binder.binderId).eq("pokemon_id", pokemonId)
    const { error } = result
    const paused = legacyWritePausedResponse(error)
    if (paused) return paused
    if ("data" in result && result.data?.conflict) {
      const { data: current, error: readError } = await scopeCollectionQuery(admin.from("pokemon_collection").select("*"), ownerUserId, binder.binderId).eq("pokemon_id", pokemonId).maybeSingle()
      if (readError) throw readError
      return NextResponse.json({ error: "Collection item changed on the server", item: current ? normalizeCollectionItem(current) : null }, { status: 409 })
    }

    if (error) {
      const recipientFailure = strictRecipient ? recipientAccessErrorResponse(error) : null
      if (recipientFailure) return recipientFailure
      const compatibility = legacySlotCompatibilityResponse(error)
      if (compatibility) return compatibility
      console.error("[holofolder] API collection delete failed:", error)
      return NextResponse.json({ error: error.message || "Failed to delete collection item" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const paused = legacyWritePausedResponse(error)
    if (paused) return paused
    const recipientFailure = (strictRecipient || (!!verifiedOwnerId && !atomicDelete)) ? recipientAccessErrorResponse(error) : null
    if (recipientFailure) return recipientFailure
    const compatibility = legacySlotCompatibilityResponse(error)
    if (compatibility) return compatibility
    if (isBillingError(error)) return billingErrorResponse(error)
    console.error("[holofolder] API collection DELETE failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete collection item" },
      { status: 500 },
    )
  }
}
