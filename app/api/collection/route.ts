import { withAuditActor, captureAuditOperations } from "@/lib/server/audit-context"
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getFirstPartyUser } from "@/lib/supabase/session-user"
import { saveCollectionItem, updateCollectionStatus, deleteCollectionItem } from "@/lib/server/operations/collection"
async function recordedWrite(actorId:string,run:()=>Promise<Response>) {
  const operationIds=new Set<string>()
  return withAuditActor(actorId,()=>captureAuditOperations(operationIds,async()=>{
    const response=await run()
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
export async function POST(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  return recordedWrite(user.id, () => saveCollectionItem(request, user))
}
export async function PATCH(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  return recordedWrite(user.id, () => updateCollectionStatus(request, user))
}
export async function DELETE(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  return recordedWrite(user.id, () => deleteCollectionItem(request, user))
}
