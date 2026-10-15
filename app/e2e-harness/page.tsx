import { connection } from "next/server"
import { notFound } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import BinderApp from "@/components/binder-app"
import { DEFAULT_BINDER_COLOR_ID } from "@/lib/binder-colors"

// BinderApp (signed out, or signed in with ?signedIn=1) with a seeded collection for the Playwright e2e suite (e2e/).
// Only served when the server runs with BINDERDEX_E2E=1; 404 everywhere else.
const E2E_USER_ID = "00000000-0000-4000-8000-0000000000e2"

export default async function E2EHarnessPage({ searchParams }: { searchParams: Promise<{ signedIn?: string; cardArtwork?: string; readOnly?: string }> }) {
  await connection()

  if (process.env.BINDERDEX_E2E !== "1") {
    notFound()
  }

  const { signedIn, cardArtwork, readOnly } = await searchParams
  const isSignedIn = signedIn === "1"
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
      readOnlyMode={readOnly === "1"}
      initialUser={initialUser}
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
      ]}
      initialCollectionOwnerUserId={isSignedIn ? E2E_USER_ID : null}
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
