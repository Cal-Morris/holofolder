import { createHash } from "node:crypto"
import type { User } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { ensureDefaultBinderId, listOwnerBinders } from "@/lib/server/binders"
import { isBinderId, normalizeBinderName, type Binder } from "@/lib/binders/model"
import { canCreateBinder, nextBinderSortOrder, validateBinderOrder } from "@/lib/binders/manage"
import { BillingAccessError, canCreateOwnerBinder, isBillingError } from "@/lib/billing"
import { billingErrorResponse, getBillingAccess } from "@/lib/server/billing"

/**
 * Binders of the signed-in owner. A partner manages the owner's binders (they share every binder), so every
 * request resolves the owner first and then uses the service role, like /app/api/collection.
 */
async function requireOwner(user: User) {
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

export async function listBinders(actor: User) {
  try {
    const session = await requireOwner(actor)
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    return respond(await listWithCounts(session.admin, session.ownerUserId))
  } catch (error) {
    return failure("list binders", error)
  }
}

export async function createBinder(request: NextRequest, actor: User) {
  try {
    const session = await requireOwner(actor)
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    const body = await request.json().catch(() => null) as { name?: unknown } | null
    const name = normalizeBinderName(body?.name)
    if (!name) return NextResponse.json({ error: "Give the binder a name (up to 40 characters)" }, { status: 400 })

    const { admin, ownerUserId } = session
    const binders = await listOwnerBinders(admin, ownerUserId)
    const retryKey = request.headers.get("idempotency-key")
    if (!retryKey && !canCreateBinder(binders)) {
      return NextResponse.json({ error: "You have the most binders allowed" }, { status: 409 })
    }
    const access = await getBillingAccess(ownerUserId)
    if (!retryKey && !canCreateOwnerBinder(access, binders.length)) throw new BillingAccessError('binder_limit_reached')
    const { data, error } = retryKey
      ? await admin.rpc("developer_create_binder", { actor: actor.id, owner_id: ownerUserId, binder_name: name, retry_key: retryKey,
          digest: createHash("sha256").update(JSON.stringify({ ownerUserId, name })).digest("hex") })
      : await admin.from("binders")
          .insert({ owner_user_id: ownerUserId, name, sort_order: nextBinderSortOrder(binders), is_default: binders.length === 0 })
          .select("id").single()
    if (error?.message?.includes("idempotency_conflict")) return NextResponse.json({ error: "This idempotency key was used with another request." }, { status: 409 })
    if (isBillingError(error)) throw new BillingAccessError('binder_limit_reached')
    if (error?.message?.includes('binder_safety_limit_reached')) return NextResponse.json({ error: "You have the most binders allowed" }, { status: 409 })
    if (error) throw error
    return respond(await listWithCounts(admin, ownerUserId), { createdBinderId: data.id })
  } catch (error) {
    if (isBillingError(error)) return billingErrorResponse(error)
    return failure("create the binder", error)
  }
}

export async function updateBinder(request: NextRequest, actor: User) {
  try {
    const session = await requireOwner(actor)
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    const { admin, ownerUserId } = session
    const body = await request.json().catch(() => null) as { id?: unknown; name?: unknown; order?: unknown } | null
    const binders = await listOwnerBinders(admin, ownerUserId)

    if (body?.order !== undefined) {
      const order = validateBinderOrder(binders, body.order)
      if (!order) return NextResponse.json({ error: "The order must list every binder once" }, { status: 400 })
      const result = await admin.rpc("developer_reorder_binders", { actor: actor.id, owner_id: ownerUserId, binder_order: order })
      if (result.error) throw result.error
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

export async function deleteBinder(request: NextRequest, actor: User) {
  try {
    const session = await requireOwner(actor)
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    const { admin, ownerUserId } = session
    const params = new URL(request.url).searchParams
    const binderId = params.get("id")
    if (!isBinderId(binderId)) return NextResponse.json({ error: "Binder not found" }, { status: 404 })
    const {data:plan,error}=await admin.rpc('developer_delete_binder',{actor:actor.id,owner_id:ownerUserId,binder_id_input:binderId,confirm_populated:params.get('confirm')==='1'})
    if(error)throw error
    if(!plan?.ok) {
      const reason=plan?.reason??'not-found'
      const message=reason==='last-binder'?"You can't delete your only binder":reason==='needs-confirmation'?'This binder has cards; confirm to delete them too':'Binder not found'
      return NextResponse.json({error:message,reason,slotCount:plan?.slotCount??0},{status:reason==='not-found'?404:409})
    }

    return respond(await listWithCounts(admin, ownerUserId), { deletedBinderId: binderId })
  } catch (error) {
    return failure("delete the binder", error)
  }
}
