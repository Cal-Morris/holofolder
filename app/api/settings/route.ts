import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { DEFAULT_BINDER_COLOR_ID } from "@/lib/binder-colors"
import { USER_SETTINGS_COLUMNS, settingsFromRow, settingsToRow } from "@/lib/settings"

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

async function resolveSettingsOwnerUserId(userId: string) {
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

export async function GET() {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const admin = createAdminClient()
    const settingsOwnerUserId = await resolveSettingsOwnerUserId(user.id)
    const { data, error } = await admin
      .from("user_settings")
      .select(USER_SETTINGS_COLUMNS)
      .eq("user_id", settingsOwnerUserId)
      .maybeSingle()

    if (error) {
      console.error("[binderdex] API settings fetch failed:", error)
      return NextResponse.json({ error: error.message || "Failed to load settings" }, { status: 500 })
    }

    return NextResponse.json({
      settings: settingsFromRow(data),
      hasStoredSettings: Boolean(data),
    })
  } catch (error) {
    console.error("[binderdex] API settings GET failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load settings" },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 })
    }

    const admin = createAdminClient()
    const settingsOwnerUserId = await resolveSettingsOwnerUserId(user.id)
    const nextSettings = settingsFromRow({
      binder_rows: typeof body.binderRows === "number" ? body.binderRows : Number(body.binderRows),
      binder_cols: typeof body.binderCols === "number" ? body.binderCols : Number(body.binderCols),
      binder_color_id: typeof body.binderColorId === "string" ? body.binderColorId : DEFAULT_BINDER_COLOR_ID,
      binder_page_colors: body.binderPageColors && typeof body.binderPageColors === "object" ? body.binderPageColors : {},
      binder_slot_glare_enabled: Boolean(body.binderSlotGlareEnabled),
      card_finish_effects_enabled: body.cardFinishEffectsEnabled !== false,
      dark_mode: Boolean(body.darkMode),
    })

    const existingResult = await admin
      .from("user_settings")
      .select("user_id")
      .eq("user_id", settingsOwnerUserId)
      .maybeSingle()

    if (existingResult.error) {
      console.error("[binderdex] API settings existence check failed:", existingResult.error)
      return NextResponse.json(
        { error: existingResult.error.message || "Failed to save settings" },
        { status: 500 },
      )
    }

    const mutation = existingResult.data
      ? admin
          .from("user_settings")
          .update(settingsToRow(nextSettings))
          .eq("user_id", settingsOwnerUserId)
      : admin
          .from("user_settings")
          .insert({
            user_id: settingsOwnerUserId,
            ...settingsToRow(nextSettings),
          })

    const { error } = await mutation

    if (error) {
      console.error("[binderdex] API settings save failed:", error)
      return NextResponse.json({ error: error.message || "Failed to save settings" }, { status: 500 })
    }

    return NextResponse.json({ settings: nextSettings })
  } catch (error) {
    console.error("[binderdex] API settings PUT failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save settings" },
      { status: 500 },
    )
  }
}
