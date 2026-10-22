import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getSessionUser } from "@/lib/supabase/session-user"
import { buildBinderSharePath } from "@/lib/binder-share"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"

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

function generateShareToken() {
  return randomBytes(24).toString("base64url")
}

export async function GET() {
  try {
    const { supabase, user } = await requireSessionUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const ownerUserId = await resolveCollectionOwnerUserId(supabase, user.id)
    const { data, error } = await supabase
      .from("binder_shares")
      .select("owner_user_id, token, is_enabled")
      .eq("owner_user_id", ownerUserId)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return NextResponse.json({ share: null })
    }

    return NextResponse.json({
      share: {
        ...data,
        path: buildBinderSharePath(data.token),
      },
    })
  } catch (error) {
    console.error("[binderdex] Failed to fetch binder share:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch binder share" },
      { status: 500 },
    )
  }
}

export async function POST() {
  try {
    const { supabase, user } = await requireUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const ownerUserId = await resolveCollectionOwnerUserId(supabase, user.id)
    const existingResult = await supabase
      .from("binder_shares")
      .select("owner_user_id, token, is_enabled")
      .eq("owner_user_id", ownerUserId)
      .maybeSingle()

    if (existingResult.error) {
      throw existingResult.error
    }

    const token = existingResult.data?.token || generateShareToken()
    const { data, error } = await supabase
      .from("binder_shares")
      .upsert(
        {
          owner_user_id: ownerUserId,
          token,
          is_enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_user_id" },
      )
      .select("owner_user_id, token, is_enabled")
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({
      share: {
        ...data,
        path: buildBinderSharePath(data.token),
      },
    })
  } catch (error) {
    console.error("[binderdex] Failed to enable binder share:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to enable binder share" },
      { status: 500 },
    )
  }
}

export async function DELETE() {
  try {
    const { supabase, user } = await requireUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const ownerUserId = await resolveCollectionOwnerUserId(supabase, user.id)
    const { data, error } = await supabase
      .from("binder_shares")
      .update({
        is_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_user_id", ownerUserId)
      .select("owner_user_id, token, is_enabled")
      .maybeSingle()

    if (error) {
      throw error
    }

    return NextResponse.json({
      share: data
        ? {
            ...data,
            path: buildBinderSharePath(data.token),
          }
        : null,
    })
  } catch (error) {
    console.error("[binderdex] Failed to disable binder share:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to disable binder share" },
      { status: 500 },
    )
  }
}
