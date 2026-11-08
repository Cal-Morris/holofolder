import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getFirstPartyUser } from "@/lib/supabase/session-user"
import { saveCollectionItem, updateCollectionStatus, deleteCollectionItem } from "@/lib/server/operations/collection"
export async function POST(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  return saveCollectionItem(request, user)
}
export async function PATCH(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  return updateCollectionStatus(request, user)
}
export async function DELETE(request: NextRequest) {
  const client = await createClient()
  const user = (await getFirstPartyUser(client)).data.user
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  return deleteCollectionItem(request, user)
}
