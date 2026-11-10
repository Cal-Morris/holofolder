/* eslint-disable react-hooks/rules-of-hooks -- Isolated effect runner exercises hooks without a renderer. */
import assert from "node:assert/strict"
import { AuthInvalidJwtError, AuthRetryableFetchError } from "@supabase/supabase-js"
import type { InventoryReadScope } from "../../lib/collection/inventory-read-transport"

async function useRun() {
  // Isolated subprocess: exercise the actual hook's effects and async authority checks.
  // @ts-expect-error Bun mock types are isolated from application types.
  const { mock } = await import("bun:test")
  const effects: (() => void | (() => void))[] = []
  let state: unknown = null
  let cachedAllowed = true
  mock.module("react", () => ({
    useRef: (value: unknown) => ({ current: value }),
    useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, (value: unknown) => { state = value; if (typeof initial === "boolean") cachedAllowed = value as boolean }],
    useEffect: (effect: () => void) => { effects.push(effect) },
    useLayoutEffect: (effect: () => void) => { effects.push(effect) },
  }))
  mock.module("react-dom", () => ({ flushSync: (callback: () => void) => callback() }))
  mock.module("../../hooks/use-overlay", () => ({ closeAllOverlays: () => {} }))
  mock.module("../../lib/collection-activity", () => ({ clearActivityCache: () => {} }))
  let authCallback!: (event?: string, session?: { user: { id: string } }) => void
  let claimActor = "synthetic-account", claimSession = "synthetic-auth"
  let owner = claimActor, claimsChecks = 0, membershipChecks = 0
  let billing = true
  let membershipError: { message: string; code: string } | null = null
  let claimsError: Error | null = null
  let membershipBarrier: Promise<void> | null = null
  let barrier: Promise<void> | null = null
  const client = {
    auth: {
      onAuthStateChange: (cb: (event?: string, session?: { user: { id: string } }) => void) => { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } } },
      getClaims: async () => { claimsChecks++; await barrier; return { data: { claims: { sub: claimActor, role: "authenticated", session_id: claimSession } }, error: claimsError } },
    },
    from: () => ({ select: () => ({ or: () => ({ limit: () => ({ maybeSingle: async () => { membershipChecks++; const data = owner === claimActor ? null : { id: "synthetic-partnership", owner_user_id: owner, user1_id: claimActor, user2_id: owner }; await membershipBarrier; return { data: membershipError ? null : data, error: membershipError } } }) }) }) }),
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
  const opened = hook.currentScope()!
  assert.ok(opened)
  // Supabase repeats SIGNED_IN on every tab refocus. Benign rechecks must not remount the collection.
  target.dispatchEvent(new Event("focus"))
  assert.equal(hook.currentScope(), opened, "focus keeps the open scope while it rechecks")
  await settle()
  assert.equal(hook.currentScope(), opened, "a matching focus recheck keeps the same session")
  authCallback("SIGNED_IN", { user: { id: claimActor } }); authCallback("TOKEN_REFRESHED", { user: { id: claimActor } })
  assert.equal(hook.currentScope(), opened)
  await settle()
  assert.equal(hook.currentScope(), opened, "same-account auth events keep the same session")
  claimsError = new AuthRetryableFetchError("Synthetic disconnected", 0)
  target.dispatchEvent(new Event("online")); await settle()
  assert.equal(hook.currentScope(), opened, "a dropped connection during a recheck keeps the open collection")
  claimsError = null
  claimSession = "rotated-auth"
  target.dispatchEvent(new Event("focus")); await settle()
  const initial = hook.currentScope()!
  assert.equal(initial.authSessionId, "rotated-auth", "a changed auth session opens a fresh scope")
  assert.notEqual(initial.sessionId, opened.sessionId)
  claimActor = "other-account"
  authCallback("SIGNED_IN", { user: { id: claimActor } })
  assert.equal(hook.currentScope(), null, "another account closes the scope synchronously")
  await settle()
  assert.equal(hook.currentScope(), null)
  claimActor = "synthetic-account"
  authCallback("INITIAL_SESSION", { user: { id: claimActor } }); await settle()
  assert.ok(hook.currentScope())
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
  assert.equal(hook.currentScope()!.ownerUserId, owner, "changed membership opens a fresh owner scope")
  assert.notEqual(hook.currentScope()!.sessionId, initial.sessionId)
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
  const paused = shared.currentScope()!
  assert.equal(paused.ownerUserId, claimActor, "a definite billing denial opens only the actor's own collection")
  assert.equal((state as { partnerPaused: boolean }).partnerPaused, true, "the paused partner sees why")
  billing = true
  signalMembershipLifecycle("recheck"); await settle()
  assert.equal(shared.currentScope()!.ownerUserId, owner, "restored billing reopens the shared owner")
  assert.notEqual(shared.currentScope()!.sessionId, paused.sessionId, "own and shared scopes never share an epoch")
  assert.equal((state as { partnerPaused: boolean }).partnerPaused, false)
  const sharedOpen = shared.currentScope()!
  billing = false
  target.dispatchEvent(new Event("focus")); await settle()
  assert.equal(shared.currentScope()!.ownerUserId, claimActor, "a focus recheck that finds billing lapsed leaves the shared scope")
  assert.notEqual(shared.currentScope()!.sessionId, sharedOpen.sessionId)
  billing = true
  membershipError = { message: "Synthetic membership read failed", code: "57014" }
  signalMembershipLifecycle("recheck"); await settle()
  assert.equal(shared.currentScope(), null, "a failed membership read never falls back to own or shared scope")
  assert.deepEqual(state, { message: "Synthetic membership read failed", accessCheck: true }, "membership failures are retryable access checks")
  target.dispatchEvent(new Event("focus")); await settle()
  assert.equal(shared.currentScope(), null, "a failed retry stays closed")
  membershipError = null
  target.dispatchEvent(new Event("focus")); await settle()
  assert.equal(shared.currentScope()!.ownerUserId, owner, "a later successful check recovers the shared scope")
  billing = false
  membershipBarrier = new Promise<void>(resolve => { release = resolve })
  target.dispatchEvent(new Event("focus")); await settle()
  claimActor = "other-account"
  authCallback("SIGNED_IN", { user: { id: claimActor } })
  release(); membershipBarrier = null; await settle()
  assert.equal(shared.currentScope(), null, "an in-flight denied read cannot open own storage after the account changed")
  claimActor = "synthetic-account"; billing = true
  sharedCleanup.forEach(stop => stop?.())
  owner = claimActor
  membershipBarrier = new Promise<void>(resolve => { release = resolve })
  const stalledStart = effects.length
  cachedAllowed = true
  const stalled = useBrowserCollectionScope(claimActor, owner, true)
  const stalledCleanup = effects.slice(stalledStart).map(effect => effect())
  authCallback("SIGNED_IN"); authCallback("INITIAL_SESSION"); await settle()
  assert.equal(stalled.currentScope(), null)
  assert.equal(cachedAllowed, true, "cold-client SIGNED_IN before INITIAL_SESSION does not close read-only fallback")
  authCallback("SIGNED_OUT")
  assert.equal(cachedAllowed, false, "a later auth event closes fallback synchronously")
  release(); membershipBarrier = null; await settle()
  stalledCleanup.forEach(stop => stop?.())
  for (const [error, allowed] of [[new AuthRetryableFetchError("Synthetic disconnected", 0), true], [new AuthInvalidJwtError("Synthetic invalid signature"), false]] as const) {
    claimsError = error; cachedAllowed = true
    const start = effects.length
    const rejected = useBrowserCollectionScope(claimActor, owner, true)
    const stop = effects.slice(start).map(effect => effect())
    await settle()
    assert.equal(rejected.currentScope(), null)
    assert.equal(cachedAllowed, allowed, "retryable auth transport failure retains display, definitive invalid JWT closes it")
    stop.forEach(cleanup => cleanup?.())
  }
}
useRun().catch(error => { console.error(error); process.exitCode = 1 })
