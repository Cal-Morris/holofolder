import {settingsFingerprint} from '@/lib/developer-api/settings'
import type { User } from "@supabase/supabase-js"
import { isBinderId } from "@/lib/binders/model"
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

export async function getCollectionSettings(request: NextRequest, actor: Pick<User, "id">, withFingerprint=false, verifiedOwnerId?:string) {
  try {
    const user = actor
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const admin = createAdminClient()
    const settingsOwnerUserId = verifiedOwnerId ?? await resolveSettingsOwnerUserId(user.id)
    const binderId = request.nextUrl.searchParams.get("binderId")
    if (binderId && !isBinderId(binderId)) throw new BinderAccessError()
    const [settingsResult, binderResult] = await Promise.all([
      admin.from("user_settings").select(withFingerprint?"*":USER_SETTINGS_COLUMNS).eq("user_id", settingsOwnerUserId).maybeSingle(),
      binderId ? admin.from("binders").select("binder_rows,binder_cols").eq("id",binderId).eq("owner_user_id",settingsOwnerUserId).maybeSingle() : Promise.resolve({data:null,error:null}),
    ])
    let {data,error} = settingsResult

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

    let layout:Record<string,unknown>|null=null
    let settings = settingsFromRow(data as UserSettingsRow | null)
    if (binderId) {
      if (binderResult.error) throw binderResult.error
      if (!binderResult.data) throw new BinderAccessError()
      layout=binderResult.data
      settings = withBinderLayout(settings, {rows:binderResult.data.binder_rows,cols:binderResult.data.binder_cols})
    }
    return NextResponse.json({
      settings,
      hasStoredSettings: Boolean(data),
      ...(withFingerprint?{fingerprint:settingsFingerprint(data??null,layout)}:{}),
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

export async function saveCollectionSettings(request: NextRequest, actor: Pick<User, "id">, requireAtomic=false, verifiedOwnerId?:string) {
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
    const settingsOwnerUserId = verifiedOwnerId ?? await resolveSettingsOwnerUserId(user.id)
    // The settings row and the binder's layout are independent reads.
    const binderRead = (async () => {
      const binderId = body.binderId ? await resolveWriteBinderId(admin, settingsOwnerUserId, body.binderId) : null
      return { binderId, currentBinder: binderId ? await admin.from("binders").select("binder_rows,binder_cols").eq("id", binderId).eq("owner_user_id", settingsOwnerUserId).single() : null }
    })()
    const [existingResult, { binderId, currentBinder }] = await Promise.all([
      admin.from("user_settings").select("*").eq("user_id", settingsOwnerUserId).maybeSingle(),
      binderRead,
    ])
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

    if (existingResult.error) {
      console.error("[holofolder] API settings existence check failed:", existingResult.error)
      return NextResponse.json(
        { error: existingResult.error.message || "Failed to save settings" },
        { status: 500 },
      )
    }

    if (currentBinder?.error) throw currentBinder.error
    const previous = withBinderLayout(settingsFromRow(existingResult.data), currentBinder?.data ? { rows: currentBinder.data.binder_rows, cols: currentBinder.data.binder_cols } : null)
    const layoutChanged = nextSettings.binderRows !== previous.binderRows || nextSettings.binderCols !== previous.binderCols
    // A developer context (verifiedOwnerId) already required paid access for this owner in this request's authentication.
    if (!verifiedOwnerId && needsCustomLayoutAccess({ rows: nextSettings.binderRows, cols: nextSettings.binderCols }, { rows: previous.binderRows, cols: previous.binderCols })) {
      await requirePaidAccess(settingsOwnerUserId)
    }
    if(requireAtomic) {
      if(typeof body.baseFingerprint!=='string'||body.baseFingerprint!==settingsFingerprint(existingResult.data??null,currentBinder?.data??null))return NextResponse.json({error:'Settings changed. Reload before saving again.'},{status:409})
      const atomicRow:Record<string,unknown>=settingsToRow(nextSettings)
      if(binderId) {delete atomicRow.binder_rows;delete atomicRow.binder_cols;atomicRow.layout_rows=nextSettings.binderRows;atomicRow.layout_cols=nextSettings.binderCols}
      const {data,error}=await admin.rpc('developer_save_settings',{actor:user.id,owner_id:settingsOwnerUserId,binder_id_input:binderId,expected_settings:existingResult.data??null,expected_layout:currentBinder?.data??null,new_settings:atomicRow})
      if(error)throw error
      if(!data||data.conflict)return NextResponse.json({error:'Settings changed. Reload before saving again.'},{status:409})
      return getCollectionSettings(request,actor,true,verifiedOwnerId)
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
