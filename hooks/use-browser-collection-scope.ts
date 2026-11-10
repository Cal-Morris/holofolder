"use client"

import { isAuthRetryableFetchError } from "@supabase/supabase-js"
import { BillingAccessError } from "@/lib/billing"
import { flushSync } from "react-dom"
import { closeAllOverlays } from "@/hooks/use-overlay"
import { clearActivityCache } from "@/lib/collection-activity"
import { collectionScopeLifetime, membershipChangePending, subscribeMembershipLifecycle } from "@/lib/collection/membership-lifecycle"
import { useEffect, useLayoutEffect, useState } from "react"
import { resolveCollectionMembership } from "@/lib/server/collection-owner"
import { createClient } from "@/lib/supabase/client"
import type { InventoryReadScope } from "@/lib/collection/inventory-read-transport"

/** Checked claims and current membership own native scope; bootstrap owner IDs are display hints.
 * Invalidate synchronously in the auth callback before any claims/network await. */
export function useBrowserCollectionScope(accountId: string | null, ownerUserId: string | null, enabled: boolean) {
  const [lifetime] = useState(() => collectionScopeLifetime<InventoryReadScope>())
  const [error, setError] = useState<string | null>(null)
  const [cachedFallbackAllowed, setCachedFallbackAllowed] = useState(true)
  const [resolved, setResolved] = useState<{ accountId: string; ownerUserId: string; scope: InventoryReadScope } | null>(null)
  useLayoutEffect(() => {
    return () => { lifetime.invalidate() }
  }, [enabled, accountId, ownerUserId, lifetime])
  useEffect(() => {
    if (!enabled || !accountId) return
    let active = true
    const client = createClient()
    const invalidate = () => {
      const request = lifetime.invalidate()
      setResolved(null)
      return request
    }
    /** `keep`: a benign recheck (focus, reconnect, token refresh). The open scope stays mounted, and
     * reads in flight stay valid, unless the check proves the account, owner or auth session changed. */
    const refresh = (initial = false, keep = false) => {
      const kept = keep ? lifetime.current() : null
      if (!kept) {
        setError(null)
        if (!initial) setCachedFallbackAllowed(false)
      }
      const request = kept ? lifetime.recheck() : invalidate()
      if (membershipChangePending()) { if (kept) invalidate(); setCachedFallbackAllowed(false); return }
      const fail = (message: string, closeFallback: boolean) => {
        if (kept) invalidate()
        setError(message)
        if (closeFallback) setCachedFallbackAllowed(false)
      }
      // Auth callbacks must release the Supabase lock before checking claims.
      queueMicrotask(() => { void client.auth.getClaims().then(async ({ data, error }) => {
        if (!active || !lifetime.isCurrent(request)) return
        if (error) {
          // A dropped connection during a recheck is not a reason to close an open collection.
          if (kept && isAuthRetryableFetchError(error)) { lifetime.establish(request, kept); return }
          fail(error.message, !isAuthRetryableFetchError(error))
          return
        }
        if (data?.claims.sub !== accountId || data.claims.role !== "authenticated" || data.claims.client_id || typeof data.claims.session_id !== "string") {
          fail("inventory_sign_in_required", true)
          return
        }
        const membership = await resolveCollectionMembership(client, accountId, { strictBilling: true })
        if (!active || !lifetime.isCurrent(request)) return
        const ownerUserId = membership.ownerUserId
        if (ownerUserId !== accountId) {
          const { data: allowed, error: accessError } = await client.rpc("billing_partner_allowed", { owner_id: ownerUserId, actor_id: accountId })
          if (!active || !lifetime.isCurrent(request)) return
          if (accessError || allowed !== true) { fail(accessError?.message ?? "inventory_read_forbidden", true); return }
        }
        if (kept && kept.ownerUserId === ownerUserId && kept.authSessionId === data.claims.session_id) { lifetime.establish(request, kept); return }
        const scope = { actorUserId: accountId, ownerUserId, authSessionId: data.claims.session_id, sessionId: crypto.randomUUID() }
        if (!lifetime.establish(request, scope)) return
        setResolved({ accountId, ownerUserId, scope })
      }).catch(error => {
        if (!active || !lifetime.isCurrent(request)) return
        if (kept && isAuthRetryableFetchError(error)) { lifetime.establish(request, kept); return }
        fail(error instanceof Error ? error.message : "account_access_check_failed", error instanceof BillingAccessError
          || error?.status === 401 || error?.status === 403 || error?.code === "42501")
      }) })
    }
    let initialized = false
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      // Supabase recovery emits SIGNED_IN before INITIAL_SESSION on a cold client.
      const initial = !initialized && (event === "SIGNED_IN" || event === "INITIAL_SESSION")
      if (event === "INITIAL_SESSION") initialized = true
      // Supabase repeats SIGNED_IN/TOKEN_REFRESHED whenever the tab regains focus. The same signed-in
      // account is rechecked in the background; sign-out or another account closes the scope now.
      refresh(initial, event !== "SIGNED_OUT" && session?.user?.id === accountId)
    })
    refresh(true)
    const recheck = () => refresh(false, true)
    window.addEventListener("focus", recheck)
    window.addEventListener("online", recheck)
    const unsubscribeMembership = subscribeMembershipLifecycle(phase => {
      flushSync(() => { invalidate(); setCachedFallbackAllowed(false); closeAllOverlays() })
      try { clearActivityCache(window.localStorage) } catch { /* Scope is already closed. */ }
      if (phase === "recheck") refresh()
    })
    return () => { active = false; lifetime.invalidate(); unsubscribeMembership(); window.removeEventListener("online", recheck); subscription.unsubscribe(); window.removeEventListener("focus", recheck) }
  }, [enabled, accountId, ownerUserId, lifetime])
  return { scope: enabled && resolved?.accountId === accountId ? resolved.scope : null,
    error, cachedFallbackAllowed, currentScope: () => lifetime.current() }
}
