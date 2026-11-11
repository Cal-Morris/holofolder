import ShowHuntHarness from "@/components/show-hunt-harness"
import { headers } from "next/headers"
import { canShowInventoryHarness } from "@/lib/inventory-harness-gate"
import { syntheticSlotDisplaySnapshot } from "@/tests/fixtures/slot-display"
import { connection } from "next/server"
import { notFound } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import type { ComponentProps } from "react"
import SlotDurableSessionHarness from "@/components/slot-durable-session-harness"
import SlotPickerHarness from "@/components/slot-picker-harness"
import BinderApp from "@/components/binder-app"
import { DEFAULT_BINDER_COLOR_ID } from "@/lib/binder-colors"

// BinderApp (signed out, or signed in with ?signedIn=1) with a seeded collection for the Playwright e2e suite (e2e/).
// Only served when the server runs with HOLOFOLDER_E2E=1; 404 everywhere else.
const E2E_USER_ID = "00000000-0000-4000-8000-0000000000e2"
// ?partner=1: the signed-in user is the owner's partner, so the collection and binders belong to this owner.
const E2E_PARTNER_OWNER_ID = "00000000-0000-4000-8000-0000000000e3"
const E2E_BINDER_IDS = ["e2e00000-0000-4000-8000-000000000001", "e2e00000-0000-4000-8000-000000000002", "e2e00000-0000-4000-8000-000000000004"] as const

export default async function E2EHarnessPage({ searchParams }: { searchParams: Promise<{ showHunt?: string; browserHost?: string; signedIn?: string; cardArtwork?: string; readOnly?: string; sharePrices?: string; binders?: string; binder?: string; partner?: string; slots?: string; rows?: string; cols?: string }> }) {
  if (process.env.HOLOFOLDER_E2E !== "1") {
    notFound()
  }

  await connection()

  const { showHunt, browserHost, signedIn, cardArtwork, readOnly, sharePrices, binders: withBinders, binder, partner, slots, rows, cols } = await searchParams
  if (showHunt === "1" && canShowInventoryHarness(process.env.HOLOFOLDER_E2E, Boolean(process.env.VERCEL), (await headers()).get("host"))) return <ShowHuntHarness />
  const isSignedIn = signedIn === "1"
  const ownerUserId = partner === "1" ? E2E_PARTNER_OWNER_ID : E2E_USER_ID
  // ?binders=1: the owner has two binders ("My binder" and "Trades"); ?binder=<id> opens one.
  // ?binders=3 adds an empty third binder, "Spare".
  const binders = withBinders === "1" || withBinders === "3"
    ? [
        { id: E2E_BINDER_IDS[0], ownerUserId, name: "My binder", color: null, sortOrder: 0, isDefault: true, rows: null, cols: null, createdAt: null, updatedAt: null },
        { id: E2E_BINDER_IDS[1], ownerUserId, name: "Trades", color: null, sortOrder: 1, isDefault: false, rows: null, cols: null, createdAt: null, updatedAt: null },
        ...(withBinders === "3"
          ? [{ id: E2E_BINDER_IDS[2], ownerUserId, name: "Spare", color: null, sortOrder: 2, isDefault: false, rows: null, cols: null, createdAt: null, updatedAt: null }]
          : []),
      ]
    : []
  const activeBinderId = binders.find((item) => item.id === binder)?.id ?? binders[0]?.id ?? null
  const isSecondBinder = activeBinderId === E2E_BINDER_IDS[1]
  const isEmptyBinder = activeBinderId === E2E_BINDER_IDS[2]
  const collectedAt = "2026-01-01T00:00:00.000Z"
  // The e2e suite also plants a matching Supabase session cookie and mocks the Supabase API.
  const initialUser = isSignedIn
    ? ({
        id: E2E_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "e2e@holofolder.test",
        app_metadata: {},
        user_metadata: {},
        created_at: collectedAt,
      } as User)
    : null

  const HarnessApp = slots === "durable" ? SlotDurableSessionHarness : slots === "picker" ? SlotPickerHarness : BinderApp
  return (
    <HarnessApp
      localBrowserHost={browserHost === "1" && canShowInventoryHarness(process.env.HOLOFOLDER_E2E, Boolean(process.env.VERCEL), (await headers()).get("host"))}
      key={activeBinderId ?? "single"}
      stagedSlotDisplay={slots ? syntheticSlotDisplaySnapshot(slots === "empty") : undefined}
      initialBinders={binders}
      initialBinderId={activeBinderId}
      readOnlyMode={readOnly === "1"}
      pricingEnabled={readOnly !== "1" || sharePrices === "1"}
      initialPriceMode={readOnly === "1" && sharePrices === "1"}
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
      ].filter((item) => !isEmptyBinder && (!isSecondBinder || item.pokemon_id === 4)) as ComponentProps<typeof BinderApp>["initialCollection"]}
      initialCollectionOwnerUserId={isSignedIn ? ownerUserId : null}
      initialSettings={{
        binderRows: slots && Number(rows) >= 1 && Number(rows) <= 8 ? Number(rows) : 4,
        binderCols: slots && Number(cols) >= 1 && Number(cols) <= 8 ? Number(cols) : 4,
        binderColorId: DEFAULT_BINDER_COLOR_ID,
        binderPageColors: {},
        binderSlotGlareEnabled: false,
        cardFinishEffectsEnabled: false,
        darkMode: true,
        showBinderValue: true,
        pricingRegion: null,
        preferredCurrency: null,
        preferredCardLanguage: null,
      }}
      initialHasStoredSettings={false}
      initialDarkMode={true}
    />
  )
}
