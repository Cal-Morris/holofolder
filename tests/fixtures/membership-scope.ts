/* eslint-disable react-hooks/rules-of-hooks -- Isolated effect runner exercises hooks without a renderer. */
import assert from "node:assert/strict"
import type { InventoryReadScope } from "../../lib/collection/inventory-read-transport"

async function useRun() {
  // Isolated subprocess: exercise the actual hook's effects and async authority checks.
  // @ts-expect-error Bun mock types are isolated from application types.
  const { mock } = await import("bun:test")
  const effects: (() => void | (() => void))[] = []
  let state: unknown = null
  mock.module("react", () => ({
    useRef: (value: unknown) => ({ current: value }),
    useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, (value: unknown) => { state = value }],
    useEffect: (effect: () => void) => { effects.push(effect) },
    useLayoutEffect: (effect: () => void) => { effects.push(effect) },
  }))
  mock.module("react-dom", () => ({ flushSync: (callback: () => void) => callback() }))
  mock.module("../../hooks/use-overlay", () => ({ closeAllOverlays: () => {} }))
  mock.module("../../lib/collection-activity", () => ({ clearActivityCache: () => {} }))
  let authCallback!: () => void
  let claimActor = "synthetic-account", claimSession = "synthetic-auth"
  let owner = claimActor, claimsChecks = 0, membershipChecks = 0
  let billing = true
  let membershipBarrier: Promise<void> | null = null
  let barrier: Promise<void> | null = null
  const client = {
    auth: {
      onAuthStateChange: (cb: () => void) => { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } } },
      getClaims: async () => { claimsChecks++; await barrier; return { data: { claims: { sub: claimActor, session_id: claimSession } }, error: null } },
    },
    from: () => ({ select: () => ({ or: () => ({ limit: () => ({ maybeSingle: async () => { membershipChecks++; const data = owner === claimActor ? null : { id: "synthetic-partnership", owner_user_id: owner, user1_id: claimActor, user2_id: owner }; await membershipBarrier; return { data, error: null } } }) }) }) }),
    rpc: async () => ({ data: billing, error: null }),
  }
  mock.module("../../lib/supabase/client", () => ({ createClient: () => client }))
  const target = new EventTarget()
  Object.assign(globalThis, { window: Object.assign(target, { localStorage: { setItem() {} } }) })
  const { useBrowserCollectionScope } = await import("../../hooks/use-browser-collection-scope")
  const { changeMembership, signalMembershipLifecycle } = await import("../../lib/collection/membership-lifecycle")
  const hook = useBrowserCollectionScope(claimActor, claimActor, true)
  const cleanup = effects.map(effect => effect())
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  await settle()
  const initial = hook.currentScope()!
  assert.ok(initial)
  let finishChange!: () => void
  const changing = changeMembership(() => new Promise<void>(resolve => { finishChange = resolve }))
  assert.equal(hook.currentScope(), null)
  target.dispatchEvent(new Event("focus")); await settle()
  assert.equal(hook.currentScope(), null, "focus cannot reopen during a pending local mutation")
  finishChange(); await changing; await settle()
  assert.notEqual(hook.currentScope()!.sessionId, initial.sessionId, "same-owner relink gets a fresh epoch")
  assert.ok(claimsChecks >= 2 && membershipChecks >= 2)
  let release!: () => void
  barrier = new Promise<void>(resolve => { release = resolve })
  authCallback()
  assert.equal(hook.currentScope(), null)
  await settle()
  signalMembershipLifecycle("pause")
  release(); barrier = null; await settle()
  assert.equal(hook.currentScope(), null, "old claims completion cannot restore a paused lifetime")
  claimActor = "other-account"
  signalMembershipLifecycle("recheck"); await settle()
  assert.equal(hook.currentScope(), null, "claims for another actor cannot authorize the old account")
  claimActor = "synthetic-account"; owner = "other-owner"
  signalMembershipLifecycle("recheck"); await settle()
  assert.equal(hook.currentScope(), null, "changed membership cannot reuse the old owner")
  owner = claimActor; claimSession = "fresh-auth-session"
  signalMembershipLifecycle("recheck"); await settle()
  assert.equal(hook.currentScope()!.authSessionId, claimSession)
  assert.equal((state as { scope: InventoryReadScope }).scope, hook.currentScope())
  membershipBarrier = new Promise<void>(resolve => { release = resolve })
  authCallback(); await settle()
  signalMembershipLifecycle("pause")
  release(); membershipBarrier = null; await settle()
  assert.equal(hook.currentScope(), null, "old membership completion cannot restore a paused lifetime")
  cleanup.forEach(stop => stop?.())
  assert.equal(hook.currentScope(), null)
  owner = "shared-owner"; billing = false
  const start = effects.length
  const shared = useBrowserCollectionScope(claimActor, owner, true)
  const sharedCleanup = effects.slice(start).map(effect => effect())
  await settle()
  assert.equal(shared.currentScope(), null, "cached or denied entitlement cannot authorize reconnect")
  billing = true
  signalMembershipLifecycle("recheck"); await settle()
  assert.equal(shared.currentScope()!.ownerUserId, owner)
  sharedCleanup.forEach(stop => stop?.())
}
useRun().catch(error => { console.error(error); process.exitCode = 1 })
