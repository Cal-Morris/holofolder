'use client';

import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { subscribeMembershipLifecycle } from '@/lib/collection/membership-lifecycle';
// oxlint-disable-next-line react-doctor/no-flush-sync -- a membership change must hide the cached collection before it carries on, not on a later render
import { flushSync } from 'react-dom';
import { closeAllOverlays } from '@/hooks/use-overlay';
import BinderApp from '@/components/binder-app';
import CollectionNavigationHost from '@/components/collection-navigation/navigation-host';
import { readBinderStartMarker } from '@/lib/binder-start';
import { browserHostCatalog, browserHostDisplayCatalog } from '@/lib/collection/browser-host-catalog';
import {
  cachedNativeIdentity,
  readCachedNativeStartup,
  readDeviceStartupSession,
} from '@/lib/collection/native-startup';
import { getOfflineStore } from '@/lib/offline-store/kv';
import { createClient } from '@/lib/supabase/client';

/** Cached display is deliberately separate from BrowserCollectionSession's authenticated scope.
 * Reconnect/auth events unmount it before entering the unchanged checked host path. */
export default function CachedNativeStartup({
  legacyProps,
  children,
  whileChecking = false,
}: {
  legacyProps: ComponentProps<typeof BinderApp>;
  children: ReactNode;
  /** Waiting host only; checked scope resolution remains mounted outside this reader. */
  whileChecking?: boolean;
}) {
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof readCachedNativeStartup>> | null>(null);
  const [notice, setNotice] = useState('');
  // oxlint-disable-next-line react-doctor/no-cascading-set-state -- the setters run in auth, storage and membership callbacks, not during the effect
  useEffect(() => {
    if (navigator.onLine && !whileChecking) return;
    // Old/legacy bootstrap has no native pointer, so it keeps its original startup.
    try {
      if (!readBinderStartMarker(localStorage)?.native) return;
    } catch {
      return;
    }
    let active = true,
      expiry: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      active = false;
      setSaved(null);
      setNotice(
        'Saved storage is paused. Connect to check your account and collection access. Pending edits are retained.',
      );
    };
    const client = createClient();
    // Token refreshes, cold-client recovery and other tabs writing storage are not account changes: the saved copy
    // stays unless the signed-in account no longer matches its saved identity.
    const sameAccount = (session: Parameters<typeof cachedNativeIdentity>[1]) =>
      session?.user.id === legacyProps.initialUser?.id && Boolean(cachedNativeIdentity(localStorage, session));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (event !== 'INITIAL_SESSION' && !sameAccount(session)) invalidate();
    });
    const recheckStorage = () => {
      void client.auth.getSession().then(({ data }) => {
        if (active && !sameAccount(data.session)) invalidate();
      }, invalidate);
    };
    const unsubscribeMembership = subscribeMembershipLifecycle(() => {
      flushSync(() => {
        invalidate();
        closeAllOverlays();
      });
    });
    // While the live check runs it replaces this copy itself; only the offline shell hands over on reconnect.
    if (!whileChecking) window.addEventListener('online', invalidate);
    window.addEventListener('storage', recheckStorage);
    void (async () => {
      const session = await readDeviceStartupSession(() => client.auth.getSession());
      if (!active || (navigator.onLine && !whileChecking)) return;
      const identity = cachedNativeIdentity(localStorage, session);
      const store = getOfflineStore();
      if (
        !identity ||
        session?.user.id !== legacyProps.initialUser?.id ||
        identity.scope.ownerUserId !== legacyProps.initialCollectionOwnerUserId ||
        !store
      )
        throw new Error('saved-scope-unavailable');
      const boot = await readCachedNativeStartup(store, identity, crypto.randomUUID());
      if (!active || (navigator.onLine && !whileChecking)) return;
      // IDB may outlive the cached identity or its earlier JWT deadline.
      const current = cachedNativeIdentity(localStorage, session);
      if (!current || JSON.stringify(current.scope) !== JSON.stringify(identity.scope))
        throw new Error('saved-scope-expired');
      expiry = setTimeout(invalidate, Math.min(2147483647, Math.max(0, current.expiresAt - Date.now())));
      setSaved(boot);
    })().catch(() => {
      if (active)
        setNotice(
          'Saved native storage is unavailable on this device. Connect to reopen it. Pending edits have not been removed.',
        );
    });
    return () => {
      active = false;
      unsubscribeMembership();
      clearTimeout(expiry);
      subscription.unsubscribe();
      window.removeEventListener('online', invalidate);
      window.removeEventListener('storage', recheckStorage);
    };
  }, [whileChecking, legacyProps.initialUser?.id, legacyProps.initialCollectionOwnerUserId]);
  if (
    !saved ||
    saved.read.scope.accountUserId !== legacyProps.initialUser?.id ||
    saved.read.scope.ownerUserId !== legacyProps.initialCollectionOwnerUserId
  )
    return (
      <>
        {notice && (
          <p
            role="status"
            className="bg-card fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+0.5rem)] z-50 rounded-lg p-3 text-sm"
          >
            {notice}
          </p>
        )}
        {children}
      </>
    );
  const { read, pending } = saved;
  const catalog = browserHostCatalog(read.catalog);
  return (
    <CollectionNavigationHost
      stagedSlabs
      scope={read.scope}
      read={read}
      binders={legacyProps.initialBinders}
      fallbackCollectionId={legacyProps.initialBinderId}
      readCurrent={async () => {
        throw new Error('cached-startup-requires-checked-session');
      }}
      scrollContainerId="collection-browser-scroll"
      // oxlint-disable-next-line react-doctor/no-render-prop-children -- CollectionNavigationHost's render-prop API, owned outside this file
      renderNationalDex={() => null}
      renderCollection={() => null}
      renderSurface={(surface) => {
        const snapshot = read.evidence.kind === 'cached' ? read.evidence.snapshot : null;
        const binder = snapshot?.binders.find((b) => b.collectionId === surface.collection?.collectionId);
        const layout =
          binder &&
          read.layouts.find(
            (l) => l.collectionId === binder.collectionId && l.layoutRevision === binder.layoutRevision,
          );
        const display =
          snapshot && binder && layout
            ? { inventory: snapshot, binder, catalog: {}, resolveCard: browserHostDisplayCatalog(read.catalog) }
            : undefined;
        // Routine cached startup has no banner; BinderApp's connection chip already says when it is offline.
        const header =
          pending > 0 ? (
            <p role="status" className="px-4 text-sm">
              {pending} pending edit{pending === 1 ? '' : 's'} to sync
            </p>
          ) : undefined;
        return (
          <BinderApp
            {...legacyProps}
            key={JSON.stringify([
              surface.visit,
              surface.state.main,
              surface.state.dexView,
              surface.collection?.collectionId,
              surface.collection?.state.view,
            ])}
            localBrowserHost={false}
            initialCollectionOwnerUserId={read.scope.ownerUserId}
            initialBinderId={binder?.collectionId ?? legacyProps.initialBinderId}
            initialCollection={surface.state.main === 'dex' ? legacyProps.initialCollection : []}
            initialSettings={{
              ...legacyProps.initialSettings,
              ...(layout ? { binderRows: layout.rows, binderCols: layout.cols } : {}),
            }}
            browserHeader={header}
            browserSurface={{
              nativeConsumer: {
                scope: read.scope,
                read,
                collectionId:
                  surface.state.main === 'inventory'
                    ? surface.state.inventory.query.collectionId || undefined
                    : (surface.state.collectionId ?? undefined),
                editingAvailable: false,
                admit: () => null,
              },
              analytics: { scope: read.scope, read },
              surface,
              toolbar: surface.header,
              storageMenu: null,
              display,
              catalog,
              editingAvailable: false,
              pending,
              receive: async () => {
                throw new Error('cached-startup-read-only');
              },
            }}
            stagedSlotDisplay={surface.state.main === 'collection' ? display : undefined}
            stagedSlotSessionId={read.scope.sessionId}
          />
        );
      }}
    />
  );
}
