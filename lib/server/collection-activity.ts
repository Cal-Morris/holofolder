import { createClient } from "@/lib/supabase/server"
import { getSessionUser } from "@/lib/supabase/session-user"
import { resolveCollectionMembership } from "@/lib/server/collection-owner"
import { readCollectionAudit } from "@/lib/server/operations/audit"
import { DEVELOPER_OPERATIONS } from "@/lib/developer-api/operations"
import { DeveloperAccessError } from "@/lib/developer-api/permissions"

/** First-party adapter. Developer grants/billing are unchanged. */
export async function firstPartyActivity(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }
  try {
    const client = await createClient()
    const user = await getSessionUser(client)
    if (!user) return Response.json({error:"Sign in to view Activity."},{status:401,headers})
    const membership = await resolveCollectionMembership(client,user.id)
    const scope = { accountId:user.id, ownerId:membership.ownerUserId, memberIds:membership.memberIds,
      membershipKey:JSON.stringify([membership.partnershipId,...membership.memberIds.toSorted()]) }
    const params = new URL(request.url).searchParams
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return Response.json({error:"Choose valid Activity filters."},{status:400,headers})
    if (params.toString() === "scope=1") return Response.json({scope},{headers})
    const detail = params.has("id")
    const input: Record<string,unknown> = Object.fromEntries(params)
    for (const key of ["limit","pokemonId"]) if (input[key] !== undefined) input[key] = Number(input[key])
    const operation = DEVELOPER_OPERATIONS.find(op=>op.name===(detail ? "get_collection_audit" : "list_collection_audit"))!
    const parsed = operation.schema.safeParse(input)
    if (!parsed.success) return Response.json({error:"Choose valid Activity filters."},{status:400,headers})
    // Owner, partner and billing are resolved above with the session client. Stored rows are whole, so
    // they are read server-side and projected to the shown fields; signed-in users have no direct read.
    const result = await readCollectionAudit({ownerUserId:membership.ownerUserId},parsed.data,detail)
    return Response.json({scope,...(detail ? {data:[result],nextCursor:null} : result),syncedAt:new Date().toISOString()},{headers})
  } catch (error) {
    const status = error instanceof DeveloperAccessError ? error.status : 503
    return Response.json({error: error instanceof DeveloperAccessError ? error.message : "Collection history is temporarily unavailable.",code:error instanceof DeveloperAccessError ? error.code : "audit_unavailable"},{status,headers})
  }
}
