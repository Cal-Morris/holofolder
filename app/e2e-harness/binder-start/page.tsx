import { connection } from "next/server"
import { notFound } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { BinderStart, type ServerBinderBoot } from "@/components/binder-start"
import { getDefaultBinderSettings } from "@/lib/settings"

// BinderStart with a server boot that arrives after ?serverDelay ms, for e2e/binder-start.e2e.ts.
// Only served when the server runs with HOLOFOLDER_E2E=1; 404 everywhere else.
const E2E_USER_ID = "00000000-0000-4000-8000-0000000000e2"

async function delayedBoot(delayMs: number): Promise<ServerBinderBoot> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
  const collectedAt = "2026-01-01T00:00:00.000Z"
  return {
    initialUser: { id: E2E_USER_ID, aud: "authenticated", role: "authenticated", email: "e2e@holofolder.test", app_metadata: {}, user_metadata: {}, created_at: collectedAt } as User,
    initialCollection: [
      { id: "e2e-1", pokemon_id: 1, pokemon_name: "bulbasaur", card_id: "base1-44", card_name: "Bulbasaur", card_set: "Base Set", card_language: "en", card_finish: "normal", wanted_cards: [], status: "collected", collected_at: collectedAt },
    ],
    initialCollectionOwnerUserId: E2E_USER_ID,
    initialBinders: [],
    initialBinderId: null,
    initialSettings: getDefaultBinderSettings(),
    initialHasStoredSettings: false,
    initialDarkMode: true,
  }
}

export default async function BinderStartHarness({ searchParams }: { searchParams: Promise<{ serverDelay?: string }> }) {
  await connection()
  if (process.env.HOLOFOLDER_E2E !== "1") notFound()
  const delay = Math.min(Number((await searchParams).serverDelay) || 0, 60_000)
  return <BinderStart serverBoot={delayedBoot(delay)} />
}
