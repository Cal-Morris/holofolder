import { notFound } from "next/navigation"
import type { Metadata } from "next"
import Script from "next/script"
import BinderApp from "@/components/binder-app"
import { loadBinderBootstrap } from "@/lib/server/binder-bootstrap"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveActiveBinder } from "@/lib/server/binders"


interface SharePageProps {
  params: Promise<{
    token: string
  }>
}

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}
export const instant = false

export default async function SharedBinderPage({ params }: SharePageProps) {
  const { token } = await params
  const admin = createAdminClient()

  const { data: share, error: shareError } = await admin
    .from("binder_shares")
    .select("*")
    .eq("token", token)
    .eq("is_enabled", true)
    .maybeSingle()

  if (shareError) {
    console.error("[binderdex] Failed to load binder share:", shareError)
    notFound()
  }

  if (!share?.owner_user_id) {
    notFound()
  }

  // One link per binder (migration 039); links without a binder show the owner's default binder.
  const shareBinderId = typeof share.binder_id === "string" ? share.binder_id : null
  const { binders, activeBinder } = await resolveActiveBinder(admin, share.owner_user_id, shareBinderId)
  if (shareBinderId && activeBinder?.id !== shareBinderId) notFound()
  const bootstrap = await loadBinderBootstrap(admin, share.owner_user_id, activeBinder?.id ?? null)

  if (bootstrap.collectionError) {
    console.error("[binderdex] Failed to load shared collection:", bootstrap.collectionError)
    notFound()
  }

  const initialSettings = bootstrap.settings

  return (
    <>
      <Script id="binderdex-shared-theme" strategy="beforeInteractive">
        {`document.documentElement.classList.toggle("dark", ${JSON.stringify(initialSettings.darkMode)});`}
      </Script>
      <BinderApp
        initialUser={null}
        initialCollection={bootstrap.collection}
        initialCollectionOwnerUserId={share.owner_user_id}
        initialBinders={activeBinder ? binders.filter((binder) => binder.id === activeBinder.id) : []}
        initialBinderId={activeBinder?.id ?? null}
        initialSettings={initialSettings}
        initialHasStoredSettings={bootstrap.hasStoredSettings}
        initialDarkMode={initialSettings.darkMode}
        initialPriceMode={true}
        readOnlyMode={true}
        shareViewToken={share.token}
      />
    </>
  )
}
