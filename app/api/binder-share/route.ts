import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildBinderSharePath } from "@/lib/binder-share"

export const runtime = "nodejs"

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

function generateShareToken() {
  return randomBytes(24).toString("base64url")
}

async function resolveCollectionOwnerUserId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: partnership, error } = await supabase
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

export async function GET() {
  try {
    const { supabase, user } = await requireUser()
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
