"use client"

import { flushSync } from "react-dom"
import { closeAllOverlays } from "@/hooks/use-overlay"
import { clearActivityCache } from "@/lib/collection-activity"
import { collectionScopeLifetime, membershipChangePending, subscribeMembershipLifecycle } from "@/lib/collection/membership-lifecycle"
import { useEffect, useLayoutEffect, useState } from "react"
import { resolveCollectionMembership } from "@/lib/server/collection-owner"
import { createClient } from "@/lib/supabase/client"
import type { InventoryReadScope } from "@/lib/collection/inventory-read-transport"

/** The legacy collection host resolves membership; a checked JWT supplies session identity.
 * Invalidate synchronously in the auth callback before any claims/network await. */
export function useBrowserCollectionScope(accountId: string | null, ownerUserId: string | null, enabled: boolean) {
  const [lifetime] = useState(() => collectionScopeLifetime<InventoryReadScope>())
  const [resolved, setResolved] = useState<{ accountId: string; ownerUserId: string; scope: InventoryReadScope } | null>(null)
  useLayoutEffect(() => {
    return () => { lifetime.invalidate() }
  }, [enabled, accountId, ownerUserId, lifetime])
  useEffect(() => {
    if (!enabled || !accountId || !ownerUserId) return
    let active = true
    const client = createClient()
    const invalidate = () => {
      const request = lifetime.invalidate()
      setResolved(null)
      return request
    }
    const refresh = () => {
      const request = invalidate()
      if (membershipChangePending()) return
      // Auth callbacks must release the Supabase lock before checking claims.
      queueMicrotask(() => { void client.auth.getClaims().then(async ({ data, error }) => {
        if (!active || !lifetime.isCurrent(request) || error || data?.claims.sub !== accountId || typeof data.claims.session_id !== "string") return
        const membership = await resolveCollectionMembership(client, accountId)
        if (!active || !lifetime.isCurrent(request) || membership.ownerUserId !== ownerUserId) return
        if (ownerUserId !== accountId) {
          const { data: allowed, error: accessError } = await client.rpc("billing_partner_allowed", { owner_id: ownerUserId, actor_id: accountId })
          if (accessError || allowed !== true || !active || !lifetime.isCurrent(request)) return
        }
        const scope = { actorUserId: accountId, ownerUserId, authSessionId: data.claims.session_id, sessionId: crypto.randomUUID() }
        if (!lifetime.establish(request, scope)) return
        setResolved({ accountId, ownerUserId, scope })
      }).catch(() => {}) })
    }
    const { data: { subscription } } = client.auth.onAuthStateChange(refresh)
    refresh()
    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)
    const unsubscribeMembership = subscribeMembershipLifecycle(phase => {
      flushSync(() => { invalidate(); closeAllOverlays() })
      try { clearActivityCache(window.localStorage) } catch { /* Scope is already closed. */ }
      if (phase === "recheck") refresh()
    })
    return () => { active = false; lifetime.invalidate(); unsubscribeMembership(); window.removeEventListener("online", refresh); subscription.unsubscribe(); window.removeEventListener("focus", refresh) }
  }, [enabled, accountId, ownerUserId, lifetime])
  return { scope: enabled && resolved?.accountId === accountId && resolved.ownerUserId === ownerUserId ? resolved.scope : null,
    currentScope: () => lifetime.current() }
}
