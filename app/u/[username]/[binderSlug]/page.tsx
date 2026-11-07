import { notFound } from "next/navigation"
import { connection } from "next/server"
import type { Metadata } from "next"
import type { BinderShareRecord } from "@/lib/binder-share"
import SharedBinder from "@/components/shared-binder-page"
import { buildNamedBinderSharePath, normalizeUsername, normalizeBinderSlug } from "@/lib/public-binder-identity"
import { createAdminClient } from "@/lib/supabase/admin"

export const metadata: Metadata = { robots: { index: false, follow: false } }
export const instant = false

export default async function NamedBinderPage({ params }: { params: Promise<{ username: string; binderSlug: string }> }) {
  // An enabled share must be rechecked on every request, including signed-in visits.
  await connection()
  const { username, binderSlug } = await params
  if (normalizeUsername(username) !== username || normalizeBinderSlug(binderSlug) !== binderSlug) notFound()
  const { data: share, error } = await createAdminClient().rpc("resolve_named_binder_share", {
    requested_username: username, requested_slug: binderSlug,
  }).maybeSingle<BinderShareRecord>()
  if (error || !share?.binder_id || !share.owner_user_id || !share.is_enabled || !share.token) notFound()
  return <SharedBinder share={share} path={buildNamedBinderSharePath(username, binderSlug)} />
}
