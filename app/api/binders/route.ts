import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUser } from "@/lib/supabase/session-user"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { ensureDefaultBinderId, listOwnerBinders } from "@/lib/server/binders"
import { isBinderId, normalizeBinderName, type Binder } from "@/lib/binders/model"
import { canCreateBinder, nextBinderSortOrder, planBinderDelete, validateBinderOrder } from "@/lib/binders/manage"

/**
 * Binders of the signed-in owner. A partner manages the owner's binders (they share every binder), so every
 * request resolves the owner first and then uses the service role, like /api/collection.
 */
async function requireOwner({ readOnly = false } = {}) {
  const supabase = await createClient()
  // Reads verify the session token locally (no Auth round trip); writes keep getUser().
  const user = readOnly ? await getSessionUser(supabase) : (await supabase.auth.getUser()).data.user
  if (!user) return null
  const admin = createAdminClient()
  const ownerUserId = await resolveCollectionOwnerUserId(admin, user.id)
  return { admin, ownerUserId }
}

type Admin = ReturnType<typeof createAdminClient>

async function slotCount(admin: Admin, ownerUserId: string, binderId: string) {
  const { count, error } = await admin
    .from("pokemon_collection")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ownerUserId)
    .eq("binder_id", binderId)
  if (error) throw error
  return count ?? 0
}

async function listWithCounts(admin: Admin, ownerUserId: string) {
  let binders = await listOwnerBinders(admin, ownerUserId)
  if (binders.length === 0 && await ensureDefaultBinderId(admin, ownerUserId)) {
    binders = await listOwnerBinders(admin, ownerUserId)
  }
  const counts = await Promise.all(binders.map((binder) => slotCount(admin, ownerUserId, binder.id)))
  return binders.map((binder, index) => ({ ...binder, slotCount: counts[index] }))
}

function respond(binders: Array<Binder & { slotCount: number }>, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ binders, ...extra }, { headers: { "Cache-Control": "no-store" } })
}

function failure(label: string, error: unknown) {
  console.error(`[holofolder] Failed to ${label}:`, error)
  return NextResponse.json({ error: `Failed to ${label}` }, { status: 500 })
}

export async function GET() {
  try {
    const session = await requireOwner({ readOnly: true })
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    return respond(await listWithCounts(session.admin, session.ownerUserId))
  } catch (error) {
    return failure("list binders", error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireOwner()
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    const body = await request.json().catch(() => null) as { name?: unknown } | null
    const name = normalizeBinderName(body?.name)
    if (!name) return NextResponse.json({ error: "Give the binder a name (up to 40 characters)" }, { status: 400 })

    const { admin, ownerUserId } = session
    await ensureDefaultBinderId(admin, ownerUserId)
    const binders = await listOwnerBinders(admin, ownerUserId)
    if (!canCreateBinder(binders)) {
      return NextResponse.json({ error: "You have the most binders allowed" }, { status: 409 })
    }
    const { data, error } = await admin
      .from("binders")
      .insert({ owner_user_id: ownerUserId, name, sort_order: nextBinderSortOrder(binders) })
      .select("id")
      .single()
    if (error) throw error
    return respond(await listWithCounts(admin, ownerUserId), { createdBinderId: data.id })
  } catch (error) {
    return failure("create the binder", error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireOwner()
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    const { admin, ownerUserId } = session
    const body = await request.json().catch(() => null) as { id?: unknown; name?: unknown; order?: unknown } | null
    const binders = await listOwnerBinders(admin, ownerUserId)

    if (body?.order !== undefined) {
      const order = validateBinderOrder(binders, body.order)
      if (!order) return NextResponse.json({ error: "The order must list every binder once" }, { status: 400 })
      for (const [sortOrder, id] of order.entries()) {
        const current = binders.find((binder) => binder.id === id)
        if (current?.sortOrder === sortOrder) continue
        const { error } = await admin.from("binders").update({ sort_order: sortOrder }).eq("id", id).eq("owner_user_id", ownerUserId)
        if (error) throw error
      }
      return respond(await listWithCounts(admin, ownerUserId))
    }

    if (!isBinderId(body?.id) || !binders.some((binder) => binder.id === body.id)) {
      return NextResponse.json({ error: "Binder not found" }, { status: 404 })
    }
    const name = normalizeBinderName(body?.name)
    if (!name) return NextResponse.json({ error: "Give the binder a name (up to 40 characters)" }, { status: 400 })
    const { error } = await admin.from("binders").update({ name }).eq("id", body.id).eq("owner_user_id", ownerUserId)
    if (error) throw error
    return respond(await listWithCounts(admin, ownerUserId))
  } catch (error) {
    return failure("update the binder", error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireOwner()
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    const { admin, ownerUserId } = session
    const params = new URL(request.url).searchParams
    const binderId = params.get("id")
    const binders = await listOwnerBinders(admin, ownerUserId)
    if (!isBinderId(binderId)) return NextResponse.json({ error: "Binder not found" }, { status: 404 })

    const slots = binders.some((binder) => binder.id === binderId) ? await slotCount(admin, ownerUserId, binderId) : 0
    const plan = planBinderDelete(binders, binderId, slots, params.get("confirm") === "1")
    if (!plan.ok) {
      const status = plan.reason === "not-found" ? 404 : 409
      const message = plan.reason === "last-binder"
        ? "You can't delete your only binder"
        : plan.reason === "needs-confirmation" ? "This binder has cards; confirm to delete them too" : "Binder not found"
      return NextResponse.json({ error: message, reason: plan.reason, slotCount: slots }, { status })
    }

    // Slots and the share link go with the binder (ON DELETE CASCADE).
    const { error } = await admin.from("binders").delete().eq("id", binderId).eq("owner_user_id", ownerUserId)
    if (error) throw error
    if (plan.promoteBinderId) {
      const promoted = await admin.from("binders").update({ is_default: true }).eq("id", plan.promoteBinderId).eq("owner_user_id", ownerUserId)
      if (promoted.error) throw promoted.error
    }
    return respond(await listWithCounts(admin, ownerUserId), { deletedBinderId: binderId })
  } catch (error) {
    return failure("delete the binder", error)
  }
}
