import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { DEFAULT_BINDER_COLOR_ID, type BinderColorId } from "@/lib/binder-colors"

export const runtime = "nodejs"

type UserSettingsRow = {
  binder_rows?: number | null
  binder_cols?: number | null
  binder_color_id?: string | null
  binder_page_colors?: Record<string, BinderColorId> | null
  binder_slot_glare_enabled?: boolean | null
  card_finish_effects_enabled?: boolean | null
  dark_mode?: boolean | null
}

function buildSettingsPayload(row: UserSettingsRow | null | undefined) {
  const binderRows =
    typeof row?.binder_rows === "number" && Number.isFinite(row.binder_rows) && row.binder_rows > 0
      ? row.binder_rows
      : 4
  const binderCols =
    typeof row?.binder_cols === "number" && Number.isFinite(row.binder_cols) && row.binder_cols > 0
      ? row.binder_cols
      : 4

  return {
    binderRows,
    binderCols,
    binderColorId: (row?.binder_color_id as BinderColorId | null) ?? DEFAULT_BINDER_COLOR_ID,
    binderPageColors: row?.binder_page_colors ?? {},
    binderSlotGlareEnabled: row?.binder_slot_glare_enabled ?? true,
    cardFinishEffectsEnabled: row?.card_finish_effects_enabled ?? true,
    darkMode: row?.dark_mode ?? true,
  }
}

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
      .select("binder_rows, binder_cols, binder_color_id, binder_page_colors, binder_slot_glare_enabled, card_finish_effects_enabled, dark_mode")
      .eq("user_id", settingsOwnerUserId)
      .maybeSingle()

    if (error) {
      console.error("[binderdex] API settings fetch failed:", error)
      return NextResponse.json({ error: error.message || "Failed to load settings" }, { status: 500 })
    }

    return NextResponse.json({
      settings: buildSettingsPayload(data),
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
    const nextSettings = buildSettingsPayload({
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
          .update({
            binder_rows: nextSettings.binderRows,
            binder_cols: nextSettings.binderCols,
            binder_color_id: nextSettings.binderColorId,
            binder_page_colors: nextSettings.binderPageColors,
            binder_slot_glare_enabled: nextSettings.binderSlotGlareEnabled,
            card_finish_effects_enabled: nextSettings.cardFinishEffectsEnabled,
            dark_mode: nextSettings.darkMode,
          })
          .eq("user_id", settingsOwnerUserId)
      : admin
          .from("user_settings")
          .insert({
            user_id: settingsOwnerUserId,
            binder_rows: nextSettings.binderRows,
            binder_cols: nextSettings.binderCols,
            binder_color_id: nextSettings.binderColorId,
            binder_page_colors: nextSettings.binderPageColors,
            binder_slot_glare_enabled: nextSettings.binderSlotGlareEnabled,
            card_finish_effects_enabled: nextSettings.cardFinishEffectsEnabled,
            dark_mode: nextSettings.darkMode,
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
