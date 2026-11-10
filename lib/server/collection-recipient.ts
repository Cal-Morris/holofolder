import { isBillingError } from "@/lib/billing"
import { billingErrorResponse } from "@/lib/server/billing"
import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { parseCollectionOrigin } from "@/lib/collection/recipient"
import { assertCollectionWriteAccess, resolveCollectionMembership } from "@/lib/server/collection-owner"
import { isBinderId } from "@/lib/binders/model"

// Assertions constrain the independently authenticated actor; they grant no authority.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkFirstPartyCollectionRecipient(admin: SupabaseClient<any, any, any>, actorId: string, input: unknown, explicitBinder: unknown): Promise<{ response: Response } | { membership: Awaited<ReturnType<typeof resolveCollectionMembership>>; binderId: string }> {
  const origin = parseCollectionOrigin(input)
  const retained = (code: string, error: string) => ({ response: NextResponse.json({ error, code, retainOnDevice: true }, { status: 503 }) })
  if (origin?.kind !== "account" || !isBinderId(origin.binderId) || origin.binderId !== explicitBinder)
    return retained("collection_recipient_required", "Keep this change on this device. Reload the app to review its destination.")
  if (origin.actorUserId !== actorId) return retained("collection_recipient_changed", "The signed-in account changed. Your original change must stay on this device.")
  let membership: Awaited<ReturnType<typeof resolveCollectionMembership>>
  try {
    await assertCollectionWriteAccess(admin, actorId, explicitBinder)
    membership = await resolveCollectionMembership(admin, actorId, { strictBilling: true })
  } catch (error) {
    if (isBillingError(error)) return { response: billingErrorResponse(error) }
    return retained("collection_recipient_inaccessible", "Current collection access could not be verified. Keep this change on this device.")
  }
  if (membership.ownerUserId !== origin.ownerUserId) return retained("collection_recipient_changed", "The collection owner changed. Review the original destination before uploading.")
  const { data, error } = await admin.from("binders").select("id").eq("id", origin.binderId).eq("owner_user_id", origin.ownerUserId).maybeSingle()
  if (error || !data) return retained("collection_recipient_inaccessible", "The original binder is unavailable. Your change is saved on this device.")
  return { membership, binderId: origin.binderId }
}

/** Existing atomic kernels recheck membership and binder ownership inside the write. */
export function recipientAccessErrorResponse(error: unknown): Response | null {
  if (!error || typeof error !== "object") return null
  if ("message" in error && (error.message === "Collection access denied" || error.message === "Binder not found"))
    return NextResponse.json({ error: "The original recipient is no longer accessible. Keep this change on this device.", code: "collection_recipient_inaccessible", retainOnDevice: true }, { status: 503 })
  return "cause" in error ? recipientAccessErrorResponse(error.cause) : null
}
