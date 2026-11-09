import type { OperationContext } from "@/lib/developer-api/types"
import { DeveloperAccessError } from "@/lib/developer-api/permissions"
import { decodePage, encodeCursor } from "@/lib/developer-api/pagination"
import { createAdminClient } from "@/lib/supabase/admin"

// Never select recovery_state/command_evidence: private certificates and label assets stay server-only.
export const AUDIT_READ_COLUMNS = "id::text,recorded_at,format_version,actor_kind,actor_user_id,actor_job,source,client_id,operation_id,batch_id,client_occurred_at,action,affected_entities,changes,pokemon_id,pokemon_name,before_state,after_state"
export function isAuditId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= BigInt("9223372036854775807")
}
export async function readCollectionAudit(context: OperationContext, input: Record<string, unknown>, detail = false) {
  const params = new URLSearchParams(Object.entries(input).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]))
  const page = detail ? { limit: 1, after: null } : decodePage(params)
  if ((detail && !isAuditId(input.id)) || (page.after && !isAuditId(page.after))) throw new DeveloperAccessError("invalid_pagination", "Use the cursor from this audit query.", 400)
  let query = createAdminClient().from("collection_activity").select(AUDIT_READ_COLUMNS)
    .eq("owner_user_id", context.ownerUserId).order("id", { ascending: false }).limit(page.limit + 1)
  if (detail) query = query.eq("id", String(input.id))
  if (page.after) query = query.lt("id", page.after)
  if (input.collectionId) query = query.contains("affected_entities", { collectionIds: [input.collectionId] })
  if (input.itemId) query = query.contains("affected_entities", { inventoryItemIds: [input.itemId] })
  if (input.slotId) query = query.contains("affected_entities", { slotIds: [input.slotId] })
  if (input.actorId) query = query.eq("actor_user_id", String(input.actorId))
  if (input.action) query = query.eq("action", String(input.action))
  if (input.since) query = query.gte("recorded_at", String(input.since))
  if (input.until) query = query.lte("recorded_at", String(input.until))
  const { data, error } = await query
  if (error) throw new DeveloperAccessError("audit_unavailable", "Collection history is temporarily unavailable.", 503)
  const rows = data ?? []
  if (detail) {
    if (!rows[0]) throw new DeveloperAccessError("not_found", "History entry not found.", 404)
    return rows[0]
  }
  return { data: rows.slice(0, page.limit), nextCursor: rows.length > page.limit ? encodeCursor(String(rows[page.limit - 1].id), params) : null }
}
