import { notFound } from "next/navigation"
import { connection } from "next/server"
import type { Metadata } from "next"
import SharedBinder from "@/components/shared-binder-page"
import { createAdminClient } from "@/lib/supabase/admin"

export const metadata: Metadata = { robots: { index: false, follow: false } }
export const instant = false

export default async function SharedBinderPage({ params }: { params: Promise<{ token: string }> }) {
  await connection()
  const { token } = await params
  const { data: share, error } = await createAdminClient().from("binder_shares")
    .select("owner_user_id, binder_id, token, is_enabled").eq("token", token).eq("is_enabled", true).maybeSingle()
  if (error || !share?.owner_user_id) notFound()
  return <SharedBinder share={share} />
}
