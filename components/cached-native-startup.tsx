"use client"

import { useEffect, useState, type ComponentProps, type ReactNode } from "react"
import { subscribeMembershipLifecycle } from "@/lib/collection/membership-lifecycle"
import { flushSync } from "react-dom"
import { closeAllOverlays } from "@/hooks/use-overlay"
import BinderApp from "@/components/binder-app"
import CollectionNavigationHost from "@/components/collection-navigation/navigation-host"
import { readBinderStartMarker } from "@/lib/binder-start"
import { browserHostCatalog, browserHostDisplayCatalog } from "@/lib/collection/browser-host-catalog"
import { cachedNativeIdentity, readCachedNativeStartup, readDeviceStartupSession } from "@/lib/collection/native-startup"
import { getOfflineStore } from "@/lib/offline-store/kv"
import { createClient } from "@/lib/supabase/client"

/** Cached display is deliberately separate from BrowserCollectionSession's authenticated scope.
 * Reconnect/auth events unmount it before entering the unchanged checked host path. */
export default function CachedNativeStartup({ legacyProps, children, whileChecking = false }: {
  legacyProps: ComponentProps<typeof BinderApp>
  children: ReactNode
  /** Waiting host only; checked scope resolution remains mounted outside this reader. */
  whileChecking?: boolean
}) {
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof readCachedNativeStartup>> | null>(null)
  const [notice, setNotice] = useState("")
  useEffect(() => {
    if (navigator.onLine && !whileChecking) return
    // Old/legacy bootstrap has no native pointer, so it keeps its original startup.
    try { if (!readBinderStartMarker(localStorage)?.native) return } catch { return }
    let active = true, expiry: ReturnType<typeof setTimeout> | undefined
    const invalidate = () => { active = false; setSaved(null); setNotice("Saved storage is paused. Connect to check your account and collection access. Pending edits are retained.") }
    const client = createClient()
    let initialized = false
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") { initialized = true; return }
      // Cold-client recovery is not an account change; it must match the saved identity.
      if (!initialized && event === "SIGNED_IN" && session?.user.id === legacyProps.initialUser?.id
        && cachedNativeIdentity(localStorage, session)) return
      invalidate()
    })
    const unsubscribeMembership = subscribeMembershipLifecycle(() => { flushSync(() => { invalidate(); closeAllOverlays() }) })
    window.addEventListener("online", invalidate)
    window.addEventListener("storage", invalidate)
    void (async () => {
      const session = await readDeviceStartupSession(() => client.auth.getSession())
      if (!active || navigator.onLine && !whileChecking) return
      const identity = cachedNativeIdentity(localStorage, session)
      const store = getOfflineStore()
      if (!identity || session?.user.id !== legacyProps.initialUser?.id
        || identity.scope.ownerUserId !== legacyProps.initialCollectionOwnerUserId || !store) throw new Error("saved-scope-unavailable")
      const boot = await readCachedNativeStartup(store, identity, crypto.randomUUID())
      if (!active || navigator.onLine && !whileChecking) return
      // IDB may outlive the cached identity or its earlier JWT deadline.
      const current = cachedNativeIdentity(localStorage, session)
      if (!current || JSON.stringify(current.scope) !== JSON.stringify(identity.scope)) throw new Error("saved-scope-expired")
      expiry = setTimeout(invalidate, Math.min(2147483647, Math.max(0, current.expiresAt - Date.now())))
      setSaved(boot)
    })().catch(() => { if (active) setNotice("Saved native storage is unavailable on this device. Connect to reopen it. Pending edits have not been removed.") })
    return () => { active = false; unsubscribeMembership(); clearTimeout(expiry); subscription.unsubscribe(); window.removeEventListener("online", invalidate); window.removeEventListener("storage", invalidate) }
  }, [whileChecking, legacyProps.initialUser?.id, legacyProps.initialCollectionOwnerUserId])
  if (!saved || saved.read.scope.accountUserId !== legacyProps.initialUser?.id
    || saved.read.scope.ownerUserId !== legacyProps.initialCollectionOwnerUserId) return <>{notice && <p role="status" className="fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+0.5rem)] z-50 rounded-lg bg-card p-3 text-sm">{notice}</p>}{children}</>
  const { read, pending } = saved
  const catalog = browserHostCatalog(read.catalog)
  return <CollectionNavigationHost stagedSlabs scope={read.scope} read={read} fallbackCollectionId={legacyProps.initialBinderId}
    readCurrent={async () => { throw new Error("cached-startup-requires-checked-session") }} scrollContainerId="collection-browser-scroll"
    renderNationalDex={() => null} renderCollection={() => null} renderSurface={surface => {
      const snapshot = read.evidence.kind === "cached" ? read.evidence.snapshot : null
      const binder = snapshot?.binders.find(b => b.collectionId === surface.collection?.collectionId)
      const layout = binder && read.layouts.find(l => l.collectionId === binder.collectionId && l.layoutRevision === binder.layoutRevision)
      const display = snapshot && binder && layout ? { inventory: snapshot, binder, catalog: {}, resolveCard: browserHostDisplayCatalog(read.catalog) } : undefined
      const header = <><p role="status" className="px-4 text-sm">Saved on this device · Cached only. {navigator.onLine ? "Access is being checked." : "Access will be checked when you reconnect."}{pending > 0 ? ` ${pending} pending edit${pending === 1 ? "" : "s"} retained.` : ""}</p>{surface.header}</>
      return <BinderApp {...legacyProps} key={JSON.stringify([surface.visit, surface.state.main, surface.state.dexView, surface.collection?.collectionId, surface.collection?.state.view])}
        localBrowserHost={false} initialCollectionOwnerUserId={read.scope.ownerUserId}
        initialBinderId={binder?.collectionId ?? legacyProps.initialBinderId}
        initialCollection={surface.state.main === "dex" ? legacyProps.initialCollection : []}
        initialSettings={{ ...legacyProps.initialSettings, ...(layout ? { binderRows: layout.rows, binderCols: layout.cols } : {}) }}
        browserHeader={header} browserSurface={{ nativeConsumer: { scope: read.scope, read,
          collectionId: surface.state.main === "inventory" ? surface.state.inventory.query.collectionId || undefined : surface.state.collectionId ?? undefined,
          editingAvailable: false, admit: () => null }, analytics: { scope: read.scope, read }, surface, display, catalog, editingAvailable: false, pending, receive: async () => { throw new Error("cached-startup-read-only") } }}
        stagedSlotDisplay={surface.state.main === "collection" ? display : undefined} stagedSlotSessionId={read.scope.sessionId} />
    }} />
}
