import { notFound } from "next/navigation"
import type { Metadata } from "next"
import Script from "next/script"
import BinderApp from "@/components/binder-app"
import { loadBinderBootstrap } from "@/lib/server/binder-bootstrap"
import { createAdminClient } from "@/lib/supabase/admin"


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
    .select("owner_user_id, token, is_enabled")
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

  const bootstrap = await loadBinderBootstrap(admin, share.owner_user_id)

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
