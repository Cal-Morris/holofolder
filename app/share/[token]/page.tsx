import { notFound } from "next/navigation"
import type { Metadata } from "next"
import Script from "next/script"
import BinderApp from "@/components/binder-app"
import { settingsFromRow, type BinderSettings } from "@/lib/settings"
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

  const [collectionResult, settingsResult] = await Promise.all([
    admin
      .from("pokemon_collection")
      .select("*")
      .eq("user_id", share.owner_user_id)
      .order("pokemon_id", { ascending: true }),
    admin
      .from("user_settings")
      .select("*")
      .eq("user_id", share.owner_user_id)
      .maybeSingle(),
  ])

  if (collectionResult.error) {
    console.error("[binderdex] Failed to load shared collection:", collectionResult.error)
    notFound()
  }

  const settingsRow = settingsResult.data
  const initialSettings: BinderSettings = settingsFromRow(settingsRow)

  return (
    <>
      <Script id="binderdex-shared-theme" strategy="beforeInteractive">
        {`document.documentElement.classList.toggle("dark", ${JSON.stringify(initialSettings.darkMode)});`}
      </Script>
      <BinderApp
        initialUser={null}
        initialCollection={collectionResult.data ?? []}
        initialCollectionOwnerUserId={share.owner_user_id}
        initialSettings={initialSettings}
        initialHasStoredSettings={Boolean(settingsRow)}
        initialDarkMode={initialSettings.darkMode}
        initialPriceMode={true}
        readOnlyMode={true}
        shareViewToken={share.token}
      />
    </>
  )
}
