import { withAuditActor } from "@/lib/server/audit-context"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getFirstPartyUser } from "@/lib/supabase/session-user"
import { saveCollectionItem, updateCollectionStatus, deleteCollectionItem } from "@/lib/server/operations/collection"
export async function POST(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  return withAuditActor(user.id, () => saveCollectionItem(request, user))
}
export async function PATCH(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  return withAuditActor(user.id, () => updateCollectionStatus(request, user))
}
export async function DELETE(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  return withAuditActor(user.id, () => deleteCollectionItem(request, user))
}
