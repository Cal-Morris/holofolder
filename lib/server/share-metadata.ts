import { notFound } from "next/navigation"
import type { BinderShareRecord } from "@/lib/binder-share"
import { binderShareMetadata } from "@/lib/social-metadata"
import { resolveActiveBinder } from "@/lib/server/binders"
import { createAdminClient } from "@/lib/supabase/admin"

export async function loadShareMetadata(share: BinderShareRecord) {
  if (!share.is_enabled) notFound()
  const admin = createAdminClient()
  const [{ activeBinder }, { data: identity }] = await Promise.all([
    resolveActiveBinder(admin, share.owner_user_id, share.binder_id),
    admin.from("account_identities").select("username").eq("user_id", share.owner_user_id).maybeSingle(),
  ])
  if (share.binder_id && activeBinder?.id !== share.binder_id) notFound()
  return binderShareMetadata(identity?.username, activeBinder?.name)
}
