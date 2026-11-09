"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { resolveCollectionMembership } from "@/lib/server/collection-owner"
import { createClient } from "@/lib/supabase/client"
import type { InventoryReadScope } from "@/lib/collection/inventory-read-transport"

/** The legacy collection host resolves membership; a checked JWT supplies session identity.
 * Invalidate synchronously in the auth callback before any claims/network await. */
export function useBrowserCollectionScope(accountId: string | null, ownerUserId: string | null, enabled: boolean) {
  const live = useRef<InventoryReadScope | null>(null)
  const [resolved, setResolved] = useState<{ accountId: string; ownerUserId: string; scope: InventoryReadScope } | null>(null)
  useLayoutEffect(() => {
    live.current = enabled && resolved?.accountId === accountId && resolved.ownerUserId === ownerUserId ? resolved.scope : null
    return () => { live.current = null }
  }, [enabled, accountId, ownerUserId, resolved])
  useEffect(() => {
    if (!enabled || !accountId || !ownerUserId) return
    let active = true, sequence = 0
    const client = createClient()
    const refresh = () => {
      const request = ++sequence
      live.current = null
      setResolved(null)
      // Auth callbacks must release the Supabase lock before checking claims.
      queueMicrotask(() => { void client.auth.getClaims().then(async ({ data, error }) => {
        if (!active || sequence !== request || error || data?.claims.sub !== accountId || typeof data.claims.session_id !== "string") return
        const membership = await resolveCollectionMembership(client, accountId)
        if (!active || sequence !== request || membership.ownerUserId !== ownerUserId) return
        if (ownerUserId !== accountId) {
          const { data: allowed, error: accessError } = await client.rpc("billing_partner_allowed", { owner_id: ownerUserId, actor_id: accountId })
          if (accessError || allowed !== true || !active || sequence !== request) return
        }
        const scope = { actorUserId: accountId, ownerUserId, authSessionId: data.claims.session_id, sessionId: crypto.randomUUID() }
        live.current = scope
        setResolved({ accountId, ownerUserId, scope })
      }).catch(() => {}) })
    }
    const { data: { subscription } } = client.auth.onAuthStateChange(refresh)
    refresh()
    window.addEventListener("focus", refresh)
    return () => { active = false; sequence++; live.current = null; subscription.unsubscribe(); window.removeEventListener("focus", refresh) }
  }, [enabled, accountId, ownerUserId])
  return { scope: enabled && resolved?.accountId === accountId && resolved.ownerUserId === ownerUserId ? resolved.scope : null,
    currentScope: () => live.current }
}
