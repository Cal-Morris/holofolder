import { notFound } from "next/navigation"
import { connection } from "next/server"
import { cache } from "react"
import type { Metadata } from "next"
import SharedBinder from "@/components/shared-binder-page"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadShareMetadata } from "@/lib/server/share-metadata"

export const instant = false

const loadShare = cache(async (token: string) => {
  await connection()
  const { data: share, error } = await createAdminClient().from("binder_shares")
    .select("*").eq("token", token).eq("is_enabled", true).maybeSingle()
  if (error || !share?.owner_user_id) notFound()
  return share
})

type Props = { params: Promise<{ token: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return loadShareMetadata(await loadShare((await params).token))
}

export default async function SharedBinderPage({ params }: Props) {
  const share = await loadShare((await params).token)
  return <SharedBinder share={share} />
}
