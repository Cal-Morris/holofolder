import type { SupabaseClient } from "@supabase/supabase-js"
import { isSlotContractId } from "@/lib/domain/binder-slots"
import { InventoryReadError, readOwnerInventoryState } from "@/lib/server/inventory-read"
import type { InventoryReadEnvelope } from "@/lib/collection/inventory-read-transport"

const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" }
/** Reusable private handler, deliberately NOT exported by any production route until #379.
 * client is trusted server/test injection only, otherwise uses the request cookie/RLS client.
 * Request identifiers correlate a read; neither authenticates the actor or selects an owner. */
export async function handleInventoryCompleteRead(request: Request, client?: SupabaseClient): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "inventory_read_method" }, { status: 405, headers })
  const url = new URL(request.url)
  const requestId = url.searchParams.get("requestId"), sessionId = url.searchParams.get("sessionId")
  if (!isSlotContractId(requestId) || !isSlotContractId(sessionId)
    || [...url.searchParams.keys()].some(k => !["requestId", "sessionId"].includes(k))
    || url.searchParams.getAll("requestId").length !== 1 || url.searchParams.getAll("sessionId").length !== 1) {
    return Response.json({ error: "inventory_read_request" }, { status: 400, headers })
  }
  try {
    const { snapshot, evidence, navigation, actorUserId, authSessionId } = await readOwnerInventoryState(client)
    const body: InventoryReadEnvelope = { version: 2, requestId, navigation,
      scope: { actorUserId, ownerUserId: snapshot.ownerUserId, authSessionId, sessionId }, evidence, snapshot }
    return Response.json(body, { headers })
  } catch (error) {
    const failure = error instanceof InventoryReadError ? error : new InventoryReadError("inventory_read_unavailable", 503)
    return Response.json({ error: failure.code }, { status: failure.status, headers })
  }
}
