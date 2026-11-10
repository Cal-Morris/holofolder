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
    const refresh = (initial = false) => {
      if (!initial) setCachedFallbackAllowed(false)
      const request = invalidate()
      if (membershipChangePending()) { setCachedFallbackAllowed(false); return }
      // Auth callbacks must release the Supabase lock before checking claims.
      queueMicrotask(() => { void client.auth.getClaims().then(async ({ data, error }) => {
        if (!active || !lifetime.isCurrent(request)) return
        if (error) {
          if (!isAuthRetryableFetchError(error)) setCachedFallbackAllowed(false)
          return
        }
        if (data?.claims.sub !== accountId || data.claims.role !== "authenticated" || data.claims.client_id || typeof data.claims.session_id !== "string") {
          setCachedFallbackAllowed(false)
          return
        }
        const membership = await resolveCollectionMembership(client, accountId, { strictBilling: true })
        if (!active || !lifetime.isCurrent(request)) return
        const ownerUserId = membership.ownerUserId
        if (ownerUserId !== accountId) {
          const { data: allowed, error: accessError } = await client.rpc("billing_partner_allowed", { owner_id: ownerUserId, actor_id: accountId })
          if (!active || !lifetime.isCurrent(request)) return
          if (accessError || allowed !== true) { setCachedFallbackAllowed(false); return }
        }
        const scope = { actorUserId: accountId, ownerUserId, authSessionId: data.claims.session_id, sessionId: crypto.randomUUID() }
        if (!lifetime.establish(request, scope)) return
        setResolved({ accountId, ownerUserId, scope })
      }).catch(error => {
        if (active && lifetime.isCurrent(request) && (error instanceof BillingAccessError
          || error?.status === 401 || error?.status === 403 || error?.code === "42501")) setCachedFallbackAllowed(false)
      }) })
    }
    let initialized = false
    const { data: { subscription } } = client.auth.onAuthStateChange(event => {
      // Supabase recovery emits SIGNED_IN before INITIAL_SESSION on a cold client.
      const initial = !initialized && (event === "SIGNED_IN" || event === "INITIAL_SESSION")
      if (event === "INITIAL_SESSION") initialized = true
      refresh(initial)
    })
    refresh(true)
    const recheck = () => refresh()
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
    cachedFallbackAllowed, currentScope: () => lifetime.current() }
}
