import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getSessionUser } from "@/lib/supabase/session-user"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { DEFAULT_BINDER_COLOR_ID } from "@/lib/binder-colors"
import {
  LEGACY_USER_SETTINGS_COLUMNS,
  USER_SETTINGS_COLUMNS,
  isMissingColumnError,
  settingsFromRow,
  settingsToRow,
  withoutPricingPreferenceColumns,
  type UserSettingsRow,
} from "@/lib/settings"

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Read-only: verify the session token locally (no Auth round trip). Writes keep getUser().
async function requireSessionUser() {
  return getSessionUser(await createClient())
}

async function resolveSettingsOwnerUserId(userId: string) {
  return resolveCollectionOwnerUserId(createAdminClient(), userId)
}

export async function GET() {
  try {
    const user = await requireSessionUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const admin = createAdminClient()
    const settingsOwnerUserId = await resolveSettingsOwnerUserId(user.id)
    let { data, error } = await admin
      .from("user_settings")
      .select(USER_SETTINGS_COLUMNS)
      .eq("user_id", settingsOwnerUserId)
      .maybeSingle()

    if (error && isMissingColumnError(error)) {
      // Migration 024 (pricing preferences) not applied yet: serve the legacy columns.
      ;({ data, error } = await admin
        .from("user_settings")
        .select(LEGACY_USER_SETTINGS_COLUMNS)
        .eq("user_id", settingsOwnerUserId)
        .maybeSingle())
    }

    if (error) {
      console.error("[binderdex] API settings fetch failed:", error)
      return NextResponse.json({ error: error.message || "Failed to load settings" }, { status: 500 })
    }

    return NextResponse.json({
      settings: settingsFromRow(data as UserSettingsRow | null),
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
      pricing_region: typeof body.pricingRegion === "string" ? body.pricingRegion : null,
      preferred_currency: typeof body.preferredCurrency === "string" ? body.preferredCurrency : null,
      preferred_card_language: typeof body.preferredCardLanguage === "string" ? body.preferredCardLanguage : null,
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

    const writeSettings = (row: Record<string, unknown>) => existingResult.data
      ? admin
          .from("user_settings")
          .update(row)
          .eq("user_id", settingsOwnerUserId)
      : admin
          .from("user_settings")
          .insert({
            user_id: settingsOwnerUserId,
            ...row,
          })

    const fullRow = settingsToRow(nextSettings)
    let { error } = await writeSettings(fullRow)
    if (error && isMissingColumnError(error)) {
      // Migration 024 not applied yet: save everything else; pricing preferences stay device-local.
      ;({ error } = await writeSettings(withoutPricingPreferenceColumns(fullRow)))
    }

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
