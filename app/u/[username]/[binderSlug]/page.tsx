import { notFound } from "next/navigation"
import { connection } from "next/server"
import { cache } from "react"
import type { Metadata } from "next"
import type { BinderShareRecord } from "@/lib/binder-share"
import SharedBinder from "@/components/shared-binder-page"
import { buildNamedBinderSharePath, normalizeUsername, normalizeBinderSlug } from "@/lib/public-binder-identity"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadShareMetadata } from "@/lib/server/share-metadata"

export const instant = false

const loadShare = cache(async (username: string, binderSlug: string) => {
  // An enabled share must be rechecked on every request, including signed-in visits.
  await connection()
  if (normalizeUsername(username) !== username || normalizeBinderSlug(binderSlug) !== binderSlug) notFound()
  const { data: share, error } = await createAdminClient().rpc("resolve_named_binder_share", {
    requested_username: username, requested_slug: binderSlug,
  }).maybeSingle<BinderShareRecord>()
  if (error || !share?.binder_id || !share.owner_user_id || !share.is_enabled || !share.token) notFound()
  return share
})

type Props = { params: Promise<{ username: string; binderSlug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, binderSlug } = await params
  return loadShareMetadata(await loadShare(username, binderSlug))
}

export default async function NamedBinderPage({ params }: Props) {
  const { username, binderSlug } = await params
  const share = await loadShare(username, binderSlug)
  return <SharedBinder share={share} path={buildNamedBinderSharePath(username, binderSlug)} />
}
