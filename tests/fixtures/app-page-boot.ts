import assert from "node:assert/strict"

// Isolated subprocess: the actual app/page.tsx server boot with synthetic Supabase answers.
async function main() {
  // @ts-expect-error Bun module mocks are confined to this subprocess.
  const { mock } = await import("bun:test")
  const actor = "00554000-0000-4000-8000-000000000002", owner = "00554000-0000-4000-8000-000000000001"
  let partnership: Record<string, string> | null = null, partnershipError: Error | null = null
  let allowed: boolean | null = true, billingError: { code: string; message: string } | null = null
  const owners: string[] = []
  let billingCalls = 0
  const client = {
    from: () => ({ select: () => ({ or: () => ({ limit: () => ({ maybeSingle: async () => ({ data: partnershipError ? null : partnership, error: partnershipError }) }) }) }) }),
    rpc: async () => { billingCalls++; return { data: billingError ? null : allowed, error: billingError } },
  }
  mock.module("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }))
  mock.module("../../lib/supabase/server", () => ({ createClient: async () => client }))
  mock.module("../../lib/supabase/session-user", () => ({ getSessionUser: async () => ({ id: actor }) }))
  mock.module("../../components/binder-start", () => ({ BinderStart: () => null }))
  mock.module("../../lib/server/binders", () => ({ resolveActiveBinder: async (_: unknown, id: string) => { owners.push(id); return { binders: [{ id: `${id}-binder` }], activeBinder: { id: `${id}-binder` } } } }))
  mock.module("../../lib/server/binder-bootstrap", () => ({ loadBinderBootstrap: async (_: unknown, id: string) => { owners.push(id); return { collection: [], settingsRow: null, settings: {}, hasStoredSettings: false } } }))
  const { default: Page } = await import("../../app/page")
  const boot = async () => {
    owners.length = 0
    const element = Page({ searchParams: Promise.resolve({}) }) as unknown as { props: { serverBoot: Promise<{ initialCollectionOwnerUserId: string | null; initialBinderId: string | null; initialUser: { id: string } | null }> } }
    return element.props.serverBoot
  }

  assert.equal((await boot()).initialCollectionOwnerUserId, actor, "solo owner opens their own collection")
  partnership = { id: "synthetic-partnership", owner_user_id: owner, user1_id: owner, user2_id: actor }
  assert.equal((await boot()).initialCollectionOwnerUserId, owner, "paid partner still opens the shared owner")
  allowed = false
  const paused = await boot()
  assert.equal(paused.initialCollectionOwnerUserId, actor, "unpaid or lapsed owner: the partner opens their own collection")
  assert.equal(paused.initialBinderId, `${actor}-binder`)
  assert.ok(owners.every(id => id === actor), "no shared-owner data is read for a denied partner")
  allowed = true; billingError = { code: "57014", message: "synthetic billing timeout" }
  const billingDown = await boot()
  assert.equal(billingDown.initialUser?.id, actor, "billing unavailability does not reject the page")
  assert.equal(billingDown.initialCollectionOwnerUserId, null, "billing unavailability never infers an owner")
  assert.equal(owners.length, 0)
  billingError = null; partnershipError = new Error("synthetic membership read failure")
  const membershipDown = await boot()
  assert.equal(membershipDown.initialCollectionOwnerUserId, null, "a failed membership read never falls back to own storage")
  assert.equal(owners.length, 0)
  partnershipError = null
  assert.equal((await boot()).initialCollectionOwnerUserId, owner, "the next check recovers")
  // The partnership owner is always billing-allowed for their own collection: no billing round trip.
  partnership = { id: "synthetic-partnership", owner_user_id: actor, user1_id: actor, user2_id: owner }
  billingCalls = 0
  assert.equal((await boot()).initialCollectionOwnerUserId, actor)
  assert.equal(billingCalls, 0)
  assert.deepEqual(owners, [actor, actor], "binders and settings start together for the resolved owner")
}
main().catch(error => { console.error(error); process.exitCode = 1 })
