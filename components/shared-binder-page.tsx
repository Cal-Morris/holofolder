import { getBillingAccess } from "@/lib/server/billing"
import { notFound } from "next/navigation"
import BinderApp from "@/components/binder-app"
import { publicCollectionItems, type BinderShareRecord } from "@/lib/binder-share"
import { loadBinderBootstrap } from "@/lib/server/binder-bootstrap"
import { resolveActiveBinder } from "@/lib/server/binders"
import { createAdminClient } from "@/lib/supabase/admin"

export default async function SharedBinder({ share, path }: { share: BinderShareRecord; path?: string }) {
  const access = await getBillingAccess(share.owner_user_id)
  if (access.enforced && access.tier !== "paid") notFound()
  const admin = createAdminClient()
  // Legacy token links without a binder retain their default-binder behaviour.
  const binderId = share.binder_id ?? null
  const { activeBinder } = await resolveActiveBinder(admin, share.owner_user_id, binderId)
  if (binderId && activeBinder?.id !== binderId) notFound()
  const bootstrap = await loadBinderBootstrap(admin, share.owner_user_id, activeBinder?.id ?? null)
  if (bootstrap.collectionError) notFound()
  const settings = bootstrap.settings
  return <>
    <script dangerouslySetInnerHTML={{ __html: `document.documentElement.classList.toggle("dark", ${JSON.stringify(settings.darkMode)});` }} />
    <BinderApp
      initialUser={null}
      initialCollection={publicCollectionItems(bootstrap.collection)}
      initialCollectionOwnerUserId={share.owner_user_id}
      initialBinders={activeBinder ? [activeBinder] : []}
      initialBinderId={activeBinder?.id ?? null}
      initialSettings={settings}
      initialHasStoredSettings={bootstrap.hasStoredSettings}
      initialDarkMode={settings.darkMode}
      initialPriceMode={true}
      readOnlyMode={true}
      shareViewToken={share.token}
      initialSharePath={path}
    />
  </>
}
