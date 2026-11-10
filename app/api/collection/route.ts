import { checkFirstPartyCollectionRecipient } from "@/lib/server/collection-recipient"
import { withAuditActor, captureAuditOperations, withLegacyQueueAudit } from "@/lib/server/audit-context"
import { legacyQueueProtocolResponse } from "@/lib/server/legacy-write-fence"
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getFirstPartyUser } from "@/lib/supabase/session-user"
import { saveCollectionItem, updateCollectionStatus, deleteCollectionItem } from "@/lib/server/operations/collection"
async function recordedWrite(actorId:string,request:NextRequest,run:()=>Promise<Response>) {
  const unsupported = legacyQueueProtocolResponse(request.headers)
  if (unsupported) return unsupported
  const operationIds=new Set<string>()
  return withAuditActor(actorId,()=>captureAuditOperations(operationIds,async()=>{
    const response=await (request.headers.get("X-Holo-Legacy-Queue") === "2" ? withLegacyQueueAudit(run) : run())
    if(response.ok) {
      // Missing history metadata must never turn an accepted edit into a failed write.
      try {
        const {data}=await createAdminClient().from('collection_activity').select('id::text').in('operation_id',[...operationIds]).eq('actor_user_id',actorId).eq('action','collection_item').order('id',{ascending:false}).limit(1).maybeSingle()
        if(data?.id)response.headers.set('X-Activity-Event',String(data.id))
      } catch { /* Offline/older clients keep their local Undo path. */ }
    }
    return response
  }))
}
async function checkRecipient(request: NextRequest, actorId: string) {
  const binding = request.method === "DELETE"
    ? { recipient: { kind: "account", actorUserId: request.nextUrl.searchParams.get("actorUserId"), ownerUserId: request.nextUrl.searchParams.get("ownerUserId"), binderId: request.nextUrl.searchParams.get("binderId") }, binderId: request.nextUrl.searchParams.get("binderId") }
    : await request.clone().json().catch(() => ({}))
  return checkFirstPartyCollectionRecipient(createAdminClient(), actorId, binding?.recipient, binding?.binderId)
}
export async function POST(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const checked = await checkRecipient(request, user.id)
  if ("response" in checked) return checked.response
  return recordedWrite(user.id, request, () => saveCollectionItem(request, user, false, checked.membership))
}
export async function PATCH(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const checked = await checkRecipient(request, user.id)
  if ("response" in checked) return checked.response
  return recordedWrite(user.id, request, () => updateCollectionStatus(request, user, checked.membership.ownerUserId))
}
export async function DELETE(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const checked = await checkRecipient(request, user.id)
  if ("response" in checked) return checked.response
  return recordedWrite(user.id, request, () => deleteCollectionItem(request, user, true, checked.membership.ownerUserId, true))
}
