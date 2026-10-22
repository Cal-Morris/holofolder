import { connection } from "next/server"
import { notFound } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import type { ComponentProps } from "react"
import BinderApp from "@/components/binder-app"
import { DEFAULT_BINDER_COLOR_ID } from "@/lib/binder-colors"

// BinderApp (signed out, or signed in with ?signedIn=1) with a seeded collection for the Playwright e2e suite (e2e/).
// Only served when the server runs with BINDERDEX_E2E=1; 404 everywhere else.
const E2E_USER_ID = "00000000-0000-4000-8000-0000000000e2"
// ?partner=1: the signed-in user is the owner's partner, so the collection and binders belong to this owner.
const E2E_PARTNER_OWNER_ID = "00000000-0000-4000-8000-0000000000e3"
const E2E_BINDER_IDS = ["e2e00000-0000-4000-8000-000000000001", "e2e00000-0000-4000-8000-000000000002"] as const

export default async function E2EHarnessPage({ searchParams }: { searchParams: Promise<{ signedIn?: string; cardArtwork?: string; readOnly?: string; binders?: string; binder?: string; partner?: string }> }) {
  await connection()

  if (process.env.BINDERDEX_E2E !== "1") {
    notFound()
  }

  const { signedIn, cardArtwork, readOnly, binders: withBinders, binder, partner } = await searchParams
  const isSignedIn = signedIn === "1"
  const ownerUserId = partner === "1" ? E2E_PARTNER_OWNER_ID : E2E_USER_ID
  // ?binders=1: the owner has two binders ("My binder" and "Trades"); ?binder=<id> opens one.
  const binders = withBinders === "1"
    ? [
        { id: E2E_BINDER_IDS[0], ownerUserId, name: "My binder", color: null, sortOrder: 0, isDefault: true, rows: null, cols: null, createdAt: null, updatedAt: null },
        { id: E2E_BINDER_IDS[1], ownerUserId, name: "Trades", color: null, sortOrder: 1, isDefault: false, rows: null, cols: null, createdAt: null, updatedAt: null },
      ]
    : []
  const activeBinderId = binders.find((item) => item.id === binder)?.id ?? binders[0]?.id ?? null
  const isSecondBinder = activeBinderId === E2E_BINDER_IDS[1]
  const collectedAt = "2026-01-01T00:00:00.000Z"
  // The e2e suite also plants a matching Supabase session cookie and mocks the Supabase API.
  const initialUser = isSignedIn
    ? ({
        id: E2E_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "e2e@binderdex.test",
        app_metadata: {},
        user_metadata: {},
        created_at: collectedAt,
      } as User)
    : null

  return (
    <BinderApp
      key={activeBinderId ?? "single"}
      initialBinders={binders}
      initialBinderId={activeBinderId}
      readOnlyMode={readOnly === "1"}
      initialUser={initialUser}
      // The second binder holds only Charmander, so a switch is visible (Bulbasaur's slot is empty there).
      initialCollection={[
        {
          id: "e2e-1",
          pokemon_id: 1,
          pokemon_name: "bulbasaur",
          card_id: "base1-44",
          card_image: cardArtwork === "1" ? "https://assets.tcgdex.net/en/base/base1/44/high.webp" : undefined,
          card_name: "Bulbasaur",
          card_set: "Base Set",
          card_language: "en",
          card_finish: "normal",
          wanted_cards: [],
          status: "collected",
          collected_at: collectedAt,
        },
        {
          id: "e2e-4",
          pokemon_id: 4,
          pokemon_name: "charmander",
          card_id: "base1-46",
          card_image: cardArtwork === "1" ? "https://assets.tcgdex.net/en/base/base1/46/high.webp" : undefined,
          card_name: "Charmander",
          card_set: "Base Set",
          card_language: "en",
          card_finish: "normal",
          wanted_cards: [],
          status: "collected",
          collected_at: collectedAt,
        },
      ].filter((item) => !isSecondBinder || item.pokemon_id === 4) as ComponentProps<typeof BinderApp>["initialCollection"]}
      initialCollectionOwnerUserId={isSignedIn ? ownerUserId : null}
      initialSettings={{
        binderRows: 4,
        binderCols: 4,
        binderColorId: DEFAULT_BINDER_COLOR_ID,
        binderPageColors: {},
        binderSlotGlareEnabled: false,
        cardFinishEffectsEnabled: false,
        darkMode: true,
        pricingRegion: null,
        preferredCurrency: null,
        preferredCardLanguage: null,
      }}
      initialHasStoredSettings={false}
      initialDarkMode={true}
    />
  )
}
