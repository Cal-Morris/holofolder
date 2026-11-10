import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getFirstPartyUser } from "@/lib/supabase/session-user"
import { resolveCollectionMembership } from "@/lib/server/collection-owner"
import { loadCollectionRows } from "@/lib/collection/load"
import { normalizeCollectionItems } from "@/lib/collection/normalize"
import { checkFirstPartyCollectionRecipient } from "@/lib/server/collection-recipient"
import { legacySlotAuthorityResponse } from "@/lib/server/operations/binder-slots"

/** Device-only review of an explicit destination. Never accepts or uploads source intent. */
export async function GET(request: NextRequest) {
  const user = (await getFirstPartyUser(await createClient())).data.user
  if (!user) return NextResponse.json({ error: "Sign in to choose a destination." }, { status: 401 })
  try {
    const admin = createAdminClient()
    const membership = await resolveCollectionMembership(admin, user.id, { strictBilling: true })
    const { data: binders, error } = await admin.from("binders").select("id,name").eq("owner_user_id", membership.ownerUserId).order("sort_order")
    if (error) throw error
    const binderId = request.nextUrl.searchParams.get("binderId")
    const recipient = { kind: "account" as const, actorUserId: user.id, ownerUserId: membership.ownerUserId, binderId }
    if (!binderId) return NextResponse.json({ recipient, memberIds: membership.memberIds, binders }, { headers: { "Cache-Control": "private, no-store" } })
    const checked = await checkFirstPartyCollectionRecipient(admin, user.id, recipient, binderId)
    if ("response" in checked) return checked.response
    const state = await admin.from("storage_collection_state").select("authority,conversion_version").eq("collection_id", binderId).eq("owner_user_id", membership.ownerUserId).maybeSingle()
    if (state.error) return NextResponse.json({ error: "The destination authority is unavailable. Keep your changes on this device.", code: "collection_recipient_inaccessible", retainOnDevice: true }, { status: 503 })
    const authority = legacySlotAuthorityResponse(state.data, state.error)
    if (authority) return authority
    const rows = await loadCollectionRows(admin, membership.ownerUserId, binderId)
    if (rows.error) throw rows.error
    return NextResponse.json({ recipient, memberIds: membership.memberIds, binders, collection: normalizeCollectionItems(rows.data) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch {
    return NextResponse.json({ error: "Could not verify the destination. Keep your changes on this device." }, { status: 503 })
  }
}
