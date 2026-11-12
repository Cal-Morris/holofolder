'use client';

import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { BillingAccessError } from '@/lib/billing';
import { flushSync } from 'react-dom';
import { closeAllOverlays } from '@/hooks/use-overlay';
import { clearActivityCache } from '@/lib/collection-activity';
import {
  collectionScopeLifetime,
  membershipChangePending,
  subscribeMembershipLifecycle,
} from '@/lib/collection/membership-lifecycle';
import { useEffect, useLayoutEffect, useState } from 'react';
import { resolveCollectionMembership } from '@/lib/server/collection-owner';
import { createClient } from '@/lib/supabase/client';
import type { InventoryReadScope } from '@/lib/collection/inventory-read-transport';

/** Checked claims and current membership own native scope; bootstrap owner IDs are display hints.
 * Invalidate synchronously in the auth callback before any claims/network await. */
export function useBrowserCollectionScope(accountId: string | null, ownerUserId: string | null, enabled: boolean) {
  const [lifetime] = useState(() => collectionScopeLifetime<InventoryReadScope>());
  const [error, setError] = useState<string | null>(null);
  const [cachedFallbackAllowed, setCachedFallbackAllowed] = useState(true);
  const [resolved, setResolved] = useState<{
    accountId: string;
    ownerUserId: string;
    scope: InventoryReadScope;
    partnerPaused: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    return () => {
      lifetime.invalidate();
    };
  }, [enabled, accountId, ownerUserId, lifetime]);
  useEffect(() => {
    if (!enabled || !accountId) return;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    const client = createClient();
    const invalidate = () => {
      const request = lifetime.invalidate();
      setResolved(null);
      return request;
    };
    /** `keep`: a benign recheck (focus, reconnect, token refresh). The open scope stays mounted, and
     * reads in flight stay valid, unless the check proves the account, owner or auth session changed. */
    const refresh = (initial = false, keep = false) => {
      const kept = keep ? lifetime.current() : null;
      if (!kept) {
        setError(null);
        // A benign recheck (focus, token refresh) of the same account before the first check finishes
        // restarts that check; it is not an account change, so the startup view stays as it is.
        if (!initial && !keep) setCachedFallbackAllowed(false);
      }
      const request = kept ? lifetime.recheck() : invalidate();
      if (membershipChangePending()) {
        if (kept) invalidate();
        setCachedFallbackAllowed(false);
        return;
      }
      /** closeFallback marks a definite answer (signed out, another account, access denied). Anything else is a
       * blip: a background recheck keeps the open collection (tearing it down unmounted the binder mid-edit), and a
       * first check retries quietly with backoff while the saved copy stays on screen. */
      const fail = (message: string, closeFallback: boolean) => {
        if (!closeFallback) {
          if (kept) lifetime.establish(request, kept);
          else {
            clearTimeout(retry);
            retry = setTimeout(() => active && refresh(initial), Math.min(30_000, 1000 * 2 ** retries++));
          }
          return;
        }
        if (kept) invalidate();
        setError(message);
        setCachedFallbackAllowed(false);
      };
      // Auth callbacks must release the Supabase lock before checking claims.
      queueMicrotask(() => {
        void client.auth
          .getClaims()
          .then(async ({ data, error }) => {
            if (!active || !lifetime.isCurrent(request)) return;
            if (error) {
              fail(error.message, !isAuthRetryableFetchError(error));
              return;
            }
            if (
              data?.claims.sub !== accountId ||
              data.claims.role !== 'authenticated' ||
              data.claims.client_id ||
              typeof data.claims.session_id !== 'string'
            ) {
              fail('inventory_sign_in_required', true);
              return;
            }
            // A definite billing denial opens the actor's own collection with a new epoch; read errors fail closed.
            const membership = await resolveCollectionMembership(client, accountId, {
              strictBilling: true,
              ownWhenDenied: true,
            });
            if (!active || !lifetime.isCurrent(request)) return;
            const ownerUserId = membership.ownerUserId;
            if (ownerUserId !== accountId) {
              const { data: allowed, error: accessError } = await client.rpc('billing_partner_allowed', {
                owner_id: ownerUserId,
                actor_id: accountId,
              });
              if (!active || !lifetime.isCurrent(request)) return;
              if (accessError) {
                fail(accessError.message, false);
                return;
              }
              if (allowed !== true) {
                fail('inventory_read_forbidden', true);
                return;
              }
            }
            if (kept && kept.ownerUserId === ownerUserId && kept.authSessionId === data.claims.session_id) {
              lifetime.establish(request, kept);
              return;
            }
            const scope = {
              actorUserId: accountId,
              ownerUserId,
              authSessionId: data.claims.session_id,
              sessionId: crypto.randomUUID(),
            };
            if (!lifetime.establish(request, scope)) return;
            retries = 0;
            setResolved({ accountId, ownerUserId, scope, partnerPaused: membership.partnerAccessDenied });
          })
          .catch((error) => {
            if (!active || !lifetime.isCurrent(request)) return;
            const denied =
              error instanceof BillingAccessError ||
              error?.status === 401 ||
              error?.status === 403 ||
              error?.code === '42501';
            fail(
              error instanceof Error || typeof error?.message === 'string'
                ? error.message
                : 'account_access_check_failed',
              denied,
            );
          });
      });
    };
    let initialized = false;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      // Supabase recovery emits SIGNED_IN before INITIAL_SESSION on a cold client.
      const initial = !initialized && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION');
      if (event === 'INITIAL_SESSION') initialized = true;
      // Supabase repeats SIGNED_IN/TOKEN_REFRESHED whenever the tab regains focus. The same signed-in
      // account is rechecked in the background; sign-out or another account closes the scope now.
      refresh(initial, event !== 'SIGNED_OUT' && session?.user?.id === accountId);
    });
    refresh(true);
    const recheck = () => refresh(false, true);
    window.addEventListener('focus', recheck);
    window.addEventListener('online', recheck);
    const unsubscribeMembership = subscribeMembershipLifecycle((phase) => {
      flushSync(() => {
        invalidate();
        setCachedFallbackAllowed(false);
        closeAllOverlays();
      });
      try {
        clearActivityCache(window.localStorage);
      } catch {
        /* Scope is already closed. */
      }
      if (phase === 'recheck') refresh();
    });
    return () => {
      active = false;
      clearTimeout(retry);
      lifetime.invalidate();
      unsubscribeMembership();
      window.removeEventListener('online', recheck);
      subscription.unsubscribe();
      window.removeEventListener('focus', recheck);
    };
  }, [enabled, accountId, ownerUserId, lifetime]);
  const current = enabled && resolved?.accountId === accountId ? resolved : null;
  return {
    scope: current?.scope ?? null,
    partnerPaused: current?.partnerPaused === true,
    error,
    cachedFallbackAllowed,
    currentScope: () => lifetime.current(),
  };
}
