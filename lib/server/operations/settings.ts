import type { User } from "@supabase/supabase-js"
import { isBinderGridSize, needsCustomLayoutAccess, withBinderLayout } from "@/lib/binder-layout"
import { BinderAccessError, resolveWriteBinderId } from "@/lib/server/binders"
import { requirePaidAccess, billingErrorResponse } from "@/lib/server/billing"
import { isBillingError } from "@/lib/billing"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { DEFAULT_BINDER_COLOR_ID } from "@/lib/binder-colors"
import {
  LEGACY_USER_SETTINGS_COLUMNS,
  PRE_VALUE_VISIBILITY_COLUMNS,
  USER_SETTINGS_COLUMNS,
  isMissingColumnError,
  settingsFromRow,
  settingsToRow,
  withoutBinderValueColumn,
  withoutPricingPreferenceColumns,
  type UserSettingsRow,
} from "@/lib/settings"

async function resolveSettingsOwnerUserId(userId: string) {
  return resolveCollectionOwnerUserId(createAdminClient(), userId)
}

export async function getCollectionSettings(request: NextRequest, actor: User) {
  try {
    const user = actor
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
      ;({ data, error } = await admin.from("user_settings").select(PRE_VALUE_VISIBILITY_COLUMNS).eq("user_id", settingsOwnerUserId).maybeSingle())
    }
    if (error && isMissingColumnError(error)) {
      // Migration 024 (pricing preferences) not applied yet: serve the legacy columns.
      ;({ data, error } = await admin
        .from("user_settings")
        .select(LEGACY_USER_SETTINGS_COLUMNS)
        .eq("user_id", settingsOwnerUserId)
        .maybeSingle())
    }

    if (error) {
      console.error("[holofolder] API settings fetch failed:", error)
      return NextResponse.json({ error: error.message || "Failed to load settings" }, { status: 500 })
    }

    const binderId = request.nextUrl.searchParams.get("binderId")
    let settings = settingsFromRow(data as UserSettingsRow | null)
    if (binderId) {
      await resolveWriteBinderId(admin, settingsOwnerUserId, binderId)
      const binder = await admin.from("binders").select("binder_rows,binder_cols").eq("id", binderId).eq("owner_user_id", settingsOwnerUserId).single()
      if (binder.error) throw binder.error
      settings = withBinderLayout(settings, { rows: binder.data.binder_rows, cols: binder.data.binder_cols })
    }
    return NextResponse.json({
      settings,
      hasStoredSettings: Boolean(data),
    })
  } catch (error) {
    if (error instanceof BinderAccessError) return NextResponse.json({ error: error.message }, { status: 404 })
    console.error("[holofolder] API settings GET failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load settings" },
      { status: 500 },
    )
  }
}

export async function saveCollectionSettings(request: NextRequest, actor: User) {
  try {
    const user = actor
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 })
    }

    if (!isBinderGridSize(body.binderRows) || !isBinderGridSize(body.binderCols)) {
      return NextResponse.json({ error: "Choose whole numbers from 1 to 8 for rows and columns" }, { status: 400 })
    }
    const admin = createAdminClient()
    const settingsOwnerUserId = await resolveSettingsOwnerUserId(user.id)
    const binderId = body.binderId ? await resolveWriteBinderId(admin, settingsOwnerUserId, body.binderId) : null
    const nextSettings = settingsFromRow({
      binder_rows: body.binderRows,
      binder_cols: body.binderCols,
      binder_color_id: typeof body.binderColorId === "string" ? body.binderColorId : DEFAULT_BINDER_COLOR_ID,
      binder_page_colors: body.binderPageColors && typeof body.binderPageColors === "object" ? body.binderPageColors : {},
      binder_slot_glare_enabled: Boolean(body.binderSlotGlareEnabled),
      card_finish_effects_enabled: body.cardFinishEffectsEnabled !== false,
      dark_mode: Boolean(body.darkMode),
      show_binder_value: body.showBinderValue !== false,
      pricing_region: typeof body.pricingRegion === "string" ? body.pricingRegion : null,
      preferred_currency: typeof body.preferredCurrency === "string" ? body.preferredCurrency : null,
      preferred_card_language: typeof body.preferredCardLanguage === "string" ? body.preferredCardLanguage : null,
    })

    const existingResult = await admin
      .from("user_settings")
      .select("user_id,binder_rows,binder_cols")
      .eq("user_id", settingsOwnerUserId)
      .maybeSingle()

    if (existingResult.error) {
      console.error("[holofolder] API settings existence check failed:", existingResult.error)
      return NextResponse.json(
        { error: existingResult.error.message || "Failed to save settings" },
        { status: 500 },
      )
    }

    const currentBinder = binderId ? await admin.from("binders").select("binder_rows,binder_cols").eq("id", binderId).eq("owner_user_id", settingsOwnerUserId).single() : null
    if (currentBinder?.error) throw currentBinder.error
    const previous = withBinderLayout(settingsFromRow(existingResult.data), currentBinder?.data ? { rows: currentBinder.data.binder_rows, cols: currentBinder.data.binder_cols } : null)
    const layoutChanged = nextSettings.binderRows !== previous.binderRows || nextSettings.binderCols !== previous.binderCols
    if (needsCustomLayoutAccess({ rows: nextSettings.binderRows, cols: nextSettings.binderCols }, { rows: previous.binderRows, cols: previous.binderCols })) {
      await requirePaidAccess(settingsOwnerUserId)
    }
    if (binderId && layoutChanged) {
      const { error } = await admin.from("binders").update({ binder_rows: nextSettings.binderRows, binder_cols: nextSettings.binderCols }).eq("id", binderId).eq("owner_user_id", settingsOwnerUserId)
      if (error?.code === "23514") return NextResponse.json({ error: "Custom layouts are not available yet. Your saved layout is unchanged." }, { status: 503 })
      if (error) throw error
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

    // Older clients must not reset a preference they do not know about.
    const fullRow: Record<string, unknown> = typeof body.showBinderValue === "boolean" ? settingsToRow(nextSettings) : withoutBinderValueColumn(settingsToRow(nextSettings))
    if (binderId) { delete fullRow.binder_rows; delete fullRow.binder_cols }
    let { error } = await writeSettings(fullRow)
    if (error && isMissingColumnError(error)) {
      ;({ error } = await writeSettings(withoutBinderValueColumn(fullRow)))
    }
    if (error && isMissingColumnError(error)) {
      // Migration 024 not applied yet: save everything else; pricing preferences stay device-local.
      ;({ error } = await writeSettings(withoutPricingPreferenceColumns(withoutBinderValueColumn(fullRow))))
    }

    if (error) {
      console.error("[holofolder] API settings save failed:", error)
      return NextResponse.json({ error: error.message || "Failed to save settings" }, { status: 500 })
    }

    return NextResponse.json({ settings: nextSettings })
  } catch (error) {
    if (error instanceof BinderAccessError) return NextResponse.json({ error: error.message }, { status: 404 })
    if (isBillingError(error)) return billingErrorResponse(error)
    console.error("[holofolder] API settings PUT failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save settings" },
      { status: 500 },
    )
  }
}
