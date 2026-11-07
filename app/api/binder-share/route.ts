import { requirePaidAccess, billingErrorResponse } from "@/lib/server/billing"
import { isBillingError } from "@/lib/billing"
import { randomBytes } from "node:crypto"
import { createClient } from "@/lib/supabase/server"
import { getSessionUser } from "@/lib/supabase/session-user"
import { namedSharePath, identityJson, requireIdentityOrigin, IdentityError } from "@/lib/server/public-binder-identity"
import { buildBinderSharePath } from "@/lib/binder-share"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { createAdminClient } from "@/lib/supabase/admin"
import { BinderAccessError, resolveWriteBinderId } from "@/lib/server/binders"

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

// Read-only: verify the session token locally (no Auth round trip). Writes keep getUser().
async function requireSessionUser() {
  const supabase = await createClient()
  return { supabase, user: await getSessionUser(supabase) }
}

/**
 * The binder a share link is for: the requested one when the owner has it, else the owner's default.
 * binderId is null only before migration 039 (one link per owner).
 */
async function resolveShareBinder(ownerUserId: string, requested: unknown) {
  try {
    return { binderId: await resolveWriteBinderId(createAdminClient(), ownerUserId, requested) }
  } catch (error) {
    if (error instanceof BinderAccessError) {
      return { response: identityJson({ error: "Binder not found" }, 404) }
    }
    throw error
  }
}

function scopeShareQuery<Query>(query: Query, ownerUserId: string, binderId: string | null): Query {
  const owned = (query as { eq(column: string, value: string): Query }).eq("owner_user_id", ownerUserId)
  return binderId ? (owned as { eq(column: string, value: string): Query }).eq("binder_id", binderId) : owned
}

const SHARE_COLUMNS = "owner_user_id, binder_id, token, is_enabled"

function generateShareToken() {
  return randomBytes(24).toString("base64url")
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireSessionUser()
    if (!user) {
      return identityJson({ error: "Not authenticated" }, 401)
    }

    const ownerUserId = await resolveCollectionOwnerUserId(supabase, user.id)
    const binder = await resolveShareBinder(ownerUserId, new URL(request.url).searchParams.get("binderId"))
    if (binder.response) return binder.response
    const { data, error } = await scopeShareQuery(
      supabase.from("binder_shares").select(SHARE_COLUMNS),
      ownerUserId,
      binder.binderId,
    ).maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return identityJson({ share: null })
    }

    return identityJson({
      share: {
        ...data,
        path: await namedSharePath(ownerUserId, binder.binderId) ?? buildBinderSharePath(data.token),
      },
    })
  } catch (error) {
    if (error instanceof IdentityError) return identityJson({ error: error.message }, error.status)
    console.error("[holofolder] Failed to fetch binder share:", error)
    return identityJson(
      { error: error instanceof Error ? error.message : "Failed to fetch binder share" },
      500,
    )
  }
}

export async function POST(request: Request) {
  try {
    requireIdentityOrigin(request)
    const { supabase, user } = await requireUser()
    if (!user) {
      return identityJson({ error: "Not authenticated" }, 401)
    }

    const ownerUserId = await resolveCollectionOwnerUserId(supabase, user.id)
    await requirePaidAccess(ownerUserId)
    const body = await request.json().catch(() => null) as { binderId?: unknown } | null
    const binder = await resolveShareBinder(ownerUserId, body?.binderId)
    if (binder.response) return binder.response
    const existingResult = await scopeShareQuery(
      supabase.from("binder_shares").select(SHARE_COLUMNS),
      ownerUserId,
      binder.binderId,
    ).maybeSingle()

    if (existingResult.error) {
      throw existingResult.error
    }

    const token = existingResult.data?.token || generateShareToken()
    const { data, error } = await supabase
      .from("binder_shares")
      .upsert(
        {
          owner_user_id: ownerUserId,
          ...(binder.binderId ? { binder_id: binder.binderId } : {}),
          token,
          is_enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: binder.binderId ? "owner_user_id,binder_id" : "owner_user_id" },
      )
      .select(SHARE_COLUMNS)
      .single()

    if (error) {
      throw error
    }

    return identityJson({
      share: {
        ...data,
        path: await namedSharePath(ownerUserId, binder.binderId) ?? buildBinderSharePath(data.token),
      },
    })
  } catch (error) {
    if (isBillingError(error)) return billingErrorResponse(error)
    if (error instanceof IdentityError) return identityJson({ error: error.message }, error.status)
    console.error("[holofolder] Failed to enable binder share:", error)
    return identityJson(
      { error: error instanceof Error ? error.message : "Failed to enable binder share" },
      500,
    )
  }
}

export async function DELETE(request: Request) {
  try {
    requireIdentityOrigin(request)
    const { supabase, user } = await requireUser()
    if (!user) {
      return identityJson({ error: "Not authenticated" }, 401)
    }

    const ownerUserId = await resolveCollectionOwnerUserId(supabase, user.id)
    const binder = await resolveShareBinder(ownerUserId, new URL(request.url).searchParams.get("binderId"))
    if (binder.response) return binder.response
    const { data, error } = await scopeShareQuery(
      supabase.from("binder_shares").update({
        is_enabled: false,
        updated_at: new Date().toISOString(),
      }),
      ownerUserId,
      binder.binderId,
    )
      .select(SHARE_COLUMNS)
      .maybeSingle()

    if (error) {
      throw error
    }

    return identityJson({
      share: data
        ? {
            ...data,
            path: await namedSharePath(ownerUserId, binder.binderId) ?? buildBinderSharePath(data.token),
          }
        : null,
    })
  } catch (error) {
    if (error instanceof IdentityError) return identityJson({ error: error.message }, error.status)
    console.error("[holofolder] Failed to disable binder share:", error)
    return identityJson(
      { error: error instanceof Error ? error.message : "Failed to disable binder share" },
      500,
    )
  }
}
