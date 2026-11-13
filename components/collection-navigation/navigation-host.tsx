'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import SlabsGallery from '@/components/slabs/slabs-gallery';
import { slabCollectionCopies } from '@/lib/slabs/collection';
import { SelectorMenu } from '@/components/collection-navigation/selector-menu';
import InventoryView, { type InventorySavedState } from '@/components/inventory/inventory-view';
import { closeAllOverlays, isOverlayHistoryCleanup, runAfterOverlayHistory } from '@/hooks/use-overlay';
import type { InventoryLocationIntent } from '@/lib/domain/inventory-browse';
import type { TCGSetSummary } from '@/lib/tcg-set-slots';
import {
  captureNavigationScroll,
  defaultCollectionView,
  navigationIndex,
  navigationLocation,
  navigationScroll,
  navigationStorageKey,
  normalizeNavigationState,
  resolveNavigation,
  type CollectionNavigationRead,
  type CollectionNavigationFocus,
  type CollectionNavigationScope,
  type CollectionNavigationState,
  type CollectionViewState,
  type InventoryViewState,
} from '@/lib/collection-navigation';
import type { InventoryOwnershipBinding } from '@/lib/inventory-actions';
import { navigationParams, writeNavigationUrl } from '@/lib/binders/url';
import styles from './navigation.module.css';

export interface NavigationSurface {
  notice: string;
  visit: number;
  content: ReactNode;
  header: ReactNode;
  state: CollectionNavigationState;
  collection: Parameters<CollectionNavigationHostProps['renderCollection']>[0] | null;
  openCreated: (collectionId: string, fresh: CollectionNavigationRead) => boolean;
  onInventory: () => void;
  /** Binder/home: the current collection in binder presentation, keeping its remembered page. */
  onBinder: () => void;
  /** Open one pocket of the current collection in its binder: that page, with the pocket's details open. */
  onSlot: (slotId: string, page: number) => void;
  onDex: () => void;
  onLegacyView: (view: 'wanted' | 'sets' | 'pokemon' | 'analytics', requestedSet?: TCGSetSummary) => void;
}

export interface CollectionNavigationHostProps {
  ownership?: InventoryOwnershipBinding;
  /** The host enables the existing Slabs renderer after its own admission. */
  stagedSlabs?: boolean;
  onEditGrading?: (itemId: string) => void;
  renderSurface?: (surface: NavigationSurface) => ReactNode;
  /** Why the shown collection may not be the very latest (still updating, offline, or the last update failed). */
  savedState?: InventorySavedState;
  /** Inventory's owned bulk price check: the signed-in owner's or partner's session while online. */
  checkPrices?: boolean;
  /** Shown as "New binder" in the collection picker. Receives the opener for the collection once it exists. */
  newCollection?: {
    disabled?: boolean;
    hint?: string;
    onSelect: (openCreated: NavigationSurface['openCreated']) => void;
  };
  fallbackCollectionId?: string | null;
  /** Binder slugs for /<slug>/binder/<page> addresses. Binders missing here use ?binder=<id>. */
  binders?: readonly { id: string; slug?: string | null }[];
  scrollContainerId?: string;
  /** Current authenticated session scope, null while signed out/rechecking membership. */
  scope: CollectionNavigationScope | null;
  read: CollectionNavigationRead;
  /** Authenticated fresh complete read, fenced by current session/membership. Never retained queue replies. */
  readCurrent: () => Promise<CollectionNavigationRead>;
  renderCollection: (context: {
    read: CollectionNavigationRead;
    collectionId: string;
    state: CollectionViewState;
    highlight: CollectionNavigationFocus | null;
    onChange: (patch: Partial<CollectionViewState>) => void;
  }) => ReactNode;
  renderNationalDex: () => ReactNode;
}
const NO_BINDERS: readonly { id: string; slug?: string | null }[] = [];
const VIEW_LABELS: Record<CollectionViewState['view'], string> = { binder: 'Binder', list: 'List', slabs: 'Slabs' };
/** Shared navigation for checked authenticated sessions and read-only cached display. */
export default function CollectionNavigationHost(props: CollectionNavigationHostProps) {
  if (!props.scope) return <p role="status">Sign in to open your collections.</p>;
  return (
    <ScopedNavigation
      key={JSON.stringify([navigationStorageKey(props.scope), props.scope.sessionId])}
      {...props}
      scope={props.scope}
    />
  );
}
function ScopedNavigation({
  scope,
  read,
  readCurrent,
  renderCollection,
  renderNationalDex,
  renderSurface,
  scrollContainerId,
  fallbackCollectionId,
  binders = NO_BINDERS,
  stagedSlabs = false,
  onEditGrading,
  ownership,
  newCollection,
  savedState,
  checkPrices,
}: CollectionNavigationHostProps & { scope: CollectionNavigationScope }) {
  const scrollElement = useCallback(() => {
    const container = scrollContainerId ? document.getElementById(scrollContainerId) : null;
    return (
      container?.querySelector<HTMLElement>('[data-testid="view-scroller"], [data-testid="wanted-list"]') ?? container
    );
  }, [scrollContainerId]);
  const scrollTop = useCallback(() => scrollElement()?.scrollTop ?? window.scrollY, [scrollElement]);
  const key = navigationStorageKey(scope);
  // Client-only host, remounted per scope: resolve the first view on the first render so a new host
  // (saved copy → checked session on startup) never paints an empty frame.
  const [initial] = useState(() => {
    let saved: unknown;
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      saved = null;
    }
    const remembered = normalizeNavigationState(saved);
    const params = navigationParams(location, binders);
    // Opening the app lands on the binder, not on Inventory because it was the last screen used.
    // A link that names a view (?view=inventory, also what a reload of that screen carries) still opens it.
    if (remembered.main === 'inventory' && !params.has('view')) remembered.main = 'collection';
    if (!saved && fallbackCollectionId) remembered.collectionId = fallbackCollectionId;
    const resolved = resolveNavigation(remembered, scope, read, params, stagedSlabs);
    // Slot and item links resolve only against a complete read. A saved copy paints first, then they resolve once.
    const deferred = read.evidence.kind !== 'complete' && (params.has('slot') || params.has('item'));
    return { ...resolved, notice: deferred ? '' : resolved.notice, deferred: deferred ? { remembered, params } : null };
  });
  // What the host shows: the destination, its notice and pocket highlight, and a visit count that remounts the view.
  // They always change together, so they are one state.
  const [shown, setShown] = useState<{
    state: CollectionNavigationState | null;
    notice: string;
    highlight: CollectionNavigationFocus | null;
    visit: number;
  }>({ state: initial.state, notice: initial.notice, highlight: initial.highlight, visit: 0 });
  const { state, notice, highlight, visit } = shown;
  const setNotice = (next: string) => setShown((current) => ({ ...current, notice: next }));
  // oxlint-disable-next-line react-doctor/rerender-state-only-in-handlers -- a render must commit first so overlay cleanup reaches history before this navigation (see the effect below)
  const [pendingNavigation, setPendingNavigation] = useState<{
    state: CollectionNavigationState;
    highlight: CollectionNavigationFocus | null;
    read: CollectionNavigationRead;
    sequence: number;
  } | null>(null);
  const entryId = useRef('');
  const [fresh, setFresh] = useState<{ base: CollectionNavigationRead; value: CollectionNavigationRead } | null>(null);
  const currentRead = fresh?.base === read ? fresh.value : read;
  const index = navigationIndex(scope, currentRead);
  const alive = useRef(true),
    request = useRef(0),
    stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const deferredLink = useRef(initial.deferred),
    navigated = useRef(false);
  const resolveDeferredLink = useEffectEvent(() => {
    const link = deferredLink.current;
    if (!link) return;
    deferredLink.current = null;
    // A navigation since the first paint (any request, or a view change) wins over the original link.
    const moved = () => navigated.current || request.current !== 0;
    if (moved()) return;
    const result = resolveNavigation(link.remembered, scope, read, link.params, stagedSlabs);
    queueMicrotask(() => {
      if (!alive.current || moved()) return;
      const changed = JSON.stringify(result.state) !== JSON.stringify(stateRef.current);
      stateRef.current = result.state;
      setShown((current) => ({
        state: result.state,
        notice: result.notice,
        highlight: result.highlight,
        visit: changed ? current.visit + 1 : current.visit,
      }));
      history.replaceState(
        { ...history.state, collectionNavigation: { key, id: entryId.current, state: result.state } },
        '',
      );
    });
  });
  useEffect(() => {
    // oxlint-disable-next-line react-doctor/no-event-handler, react-doctor/no-derived-state -- reacts to the parent's read becoming complete (data arriving, not a user event), and resolves a deep link once against it
    if (read.evidence.kind === 'complete') resolveDeferredLink();
  }, [read]);
  const persist = useCallback(
    (next: CollectionNavigationState) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Storage can be disabled. Browsing still works. */
      }
    },
    [key],
  );
  useEffect(() => {
    alive.current = true;
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    entryId.current = crypto.randomUUID();
    history.replaceState(
      { ...history.state, collectionNavigation: { key, id: entryId.current, state: initial.state } },
      '',
    );
    return () => {
      alive.current = false;
      history.scrollRestoration = previousRestoration;
    };
    // Scope changes remount this entire private host. Evidence updates are checked below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const onPop = useEffectEvent((event: PopStateEvent) => {
    if (isOverlayHistoryCleanup(event)) return;
    const entry = event.state?.collectionNavigation;
    // Shared overlay entries inherit this ID. Their dismissal is not a main-view traversal.
    if (entry?.key === key && entry.id === entryId.current) return;
    entryId.current = entry?.id ?? crypto.randomUUID();
    request.current++;
    closeAllOverlays();
    const result = resolveNavigation(
      normalizeNavigationState(entry?.key === key ? entry.state : null),
      scope,
      currentRead,
      entry?.key === key ? undefined : navigationParams(location, binders),
      stagedSlabs,
    );
    stateRef.current = result.state;
    setShown((current) => ({ state: result.state, notice: result.notice, highlight: null, visit: current.visit + 1 }));
    persist(result.state);
  });
  useEffect(() => {
    const pop = (event: PopStateEvent) => onPop(event);
    const onTraversal = (event: NavigationCurrentEntryChangeEvent) => {
      if (event.navigationType === 'traverse') onPop(new PopStateEvent('popstate', { state: history.state }));
    };
    // A native traversal can commit its entry before a framework releases popstate.
    // Entry IDs deduplicate this early notification and the eventual popstate.
    window.navigation?.addEventListener('currententrychange', onTraversal);
    window.addEventListener('popstate', pop);
    return () => {
      window.navigation?.removeEventListener('currententrychange', onTraversal);
      window.removeEventListener('popstate', pop);
    };
  }, []);
  const safe = state ? resolveNavigation(state, scope, currentRead, undefined, stagedSlabs) : null;
  const visible = safe?.state;
  const destinationKey = visible
    ? JSON.stringify([visible.main, visible.collectionId, visible.collections[visible.collectionId ?? '']?.view])
    : 'loading';
  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    const restore = () => {
      const element = scrollElement();
      if (scrollContainerId && !element) return false;
      (element ?? window).scrollTo({ top: navigationScroll(visible), behavior: 'instant' });
      return true;
    };
    const observer = new MutationObserver(() => {
      if (restore()) observer.disconnect();
    });
    frame = requestAnimationFrame(() => {
      if (!restore()) observer.observe(document.body, { childList: true, subtree: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // Query edits should not reset scroll. Restore only when the destination changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationKey, visit, scrollElement, scrollContainerId]);
  const saveScroll = useEffectEvent((event: Event) => {
    if (scrollContainerId && event.type === 'scroll' && event.target !== scrollElement()) return;
    if (!stateRef.current) return;
    const next = captureNavigationScroll(stateRef.current, scrollTop());
    stateRef.current = next;
    persist(next);
    history.replaceState({ ...history.state, collectionNavigation: { key, id: entryId.current, state: next } }, '');
  });
  useEffect(() => {
    const save = (event: Event) => saveScroll(event);
    document.addEventListener('scroll', save, { passive: true, capture: true });
    window.addEventListener('pagehide', save);
    return () => {
      document.removeEventListener('scroll', save, true);
      window.removeEventListener('pagehide', save);
    };
  }, []);
  const update = useCallback(
    (mutate: (s: CollectionNavigationState) => CollectionNavigationState) => {
      setShown((current) => {
        const old = current.state;
        if (!old) return current;
        navigated.current = true;
        const next = mutate(captureNavigationScroll(old, scrollTop()));
        stateRef.current = next;
        persist(next);
        const url = new URL(location.href);
        if (next.main === 'collection' && next.collectionId) {
          const view = next.collections[next.collectionId] ?? defaultCollectionView();
          writeNavigationUrl(url, binders, {
            main: 'collection',
            binderId: next.collectionId,
            view: view.view,
            page: view.page,
          });
        }
        history.replaceState(
          { ...history.state, collectionNavigation: { key, id: entryId.current, state: next } },
          '',
          url,
        );
        return { ...current, state: next };
      });
    },
    [persist, key, scrollTop, binders],
  );
  const inventoryChange = useCallback(
    (browse: InventoryViewState) => update((old) => ({ ...old, inventory: { ...old.inventory, ...browse } })),
    [update],
  );
  const navigate = (
    next: CollectionNavigationState,
    locationIntent: CollectionNavigationFocus | null = null,
    latest = currentRead,
  ) => {
    const sequence = ++request.current;
    closeAllOverlays();
    setPendingNavigation({ state: next, highlight: locationIntent, read: latest, sequence });
  };
  useEffect(() => {
    if (!pendingNavigation) return;
    // Overlay cleanup must commit before requesting host history, matching the shared primitive.
    runAfterOverlayHistory(() => {
      if (!alive.current || request.current !== pendingNavigation.sequence) return;
      request.current++;
      if (stateRef.current) {
        const outgoing = captureNavigationScroll(stateRef.current, scrollTop());
        history.replaceState(
          { ...history.state, collectionNavigation: { key, id: entryId.current, state: outgoing } },
          '',
        );
      }
      const result = resolveNavigation(pendingNavigation.state, scope, pendingNavigation.read, undefined, stagedSlabs);
      const { main, collectionId } = result.state,
        view = result.state.collections[collectionId ?? ''] ?? defaultCollectionView();
      const url = writeNavigationUrl(
        new URL(location.href),
        binders,
        main === 'collection' && collectionId
          ? { main, binderId: collectionId, view: view.view, page: view.page }
          : { main: main === 'collection' ? 'inventory' : main },
      );
      entryId.current = crypto.randomUUID();
      history.pushState(
        { ...history.state, collectionNavigation: { key, id: entryId.current, state: result.state } },
        '',
        url,
      );
      stateRef.current = result.state;
      persist(result.state);
      setShown((current) => ({
        state: result.state,
        notice: result.notice,
        highlight: pendingNavigation.highlight,
        visit: current.visit + 1,
      }));
      setPendingNavigation(null);
    });
  }, [pendingNavigation, scope, key, persist, scrollTop, stagedSlabs, binders]);

  const openLocation = async (intent: InventoryLocationIntent) => {
    const sequence = ++request.current;
    try {
      // oxlint-disable-next-line react-doctor/async-defer-await -- the guard below checks whether another navigation started during this await, so it must run after it
      const latest = await readCurrent();
      if (!alive.current || request.current !== sequence) return;
      const location = navigationLocation(scope, latest, intent);
      if (location.kind !== 'assigned' || location.page === null || !stateRef.current) {
        setNotice(
          location.kind === 'unassigned'
            ? "This card isn't in a binder any more."
            : "That pocket couldn't be found. It may have moved.",
        );
        return;
      }
      setFresh({ base: read, value: latest });
      const next = captureNavigationScroll(stateRef.current, scrollTop()),
        id = location.intent.collectionId;
      next.main = 'collection';
      next.collectionId = id;
      next.collections[id] = { ...defaultCollectionView(), page: location.page };
      // navigate validates against latest, not the outgoing evidence, on the next render.
      navigate(next, location.intent, latest);
    } catch {
      if (alive.current && request.current === sequence)
        setNotice("Couldn't open that pocket just now. Try again in a moment.");
    }
  };
  if (!visible) return <p role="status">Opening…</p>;
  const collectionId = visible.collectionId;
  const savedCollectionState = visible.collections[collectionId ?? ''] ?? defaultCollectionView();
  const slabCopies = stagedSlabs && collectionId ? slabCollectionCopies(scope, currentRead, collectionId) : [];
  // Slabs is a view of graded cards. A collection with none (and that isn't a slab collection) doesn't offer it,
  // and a saved or linked Slabs choice for it falls back to the binder without changing anything saved.
  const slabsOffered =
    stagedSlabs &&
    (slabCopies.length > 0 ||
      (currentRead.evidence.kind !== 'unavailable' &&
        currentRead.evidence.snapshot.collections.find((c) => c.id === collectionId)?.kind === 'slab'));
  const collectionState =
    savedCollectionState.view === 'slabs' && !slabsOffered
      ? { ...savedCollectionState, view: 'binder' as const }
      : savedCollectionState;
  // Compact: enclosed selectors, so the active collection name reads as a control. National Dex and Inventory live in the dock.
  const views: CollectionViewState['view'][] = slabsOffered ? ['binder', 'list', 'slabs'] : ['binder', 'list'];
  const viewOptions = views.map((value) => ({ value, label: VIEW_LABELS[value] }));
  const creationEntry = entryId.current,
    creationRequest = request.current;
  const openCreated: NavigationSurface['openCreated'] = (id, latest) => {
    if (
      !alive.current ||
      entryId.current !== creationEntry ||
      request.current !== creationRequest ||
      latest.evidence.kind !== 'complete' ||
      !latest.evidence.snapshot.collections.some((c) => c.id === id)
    )
      return false;
    setFresh({ base: read, value: latest });
    navigate(
      {
        ...visible,
        main: 'collection',
        collectionId: id,
        collections: {
          ...visible.collections,
          [id]: defaultCollectionView(
            latest.evidence.snapshot.collections.find((c) => c.id === id)!.defaultPresentation,
          ),
        },
      },
      null,
      latest,
    );
    return true;
  };
  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <SelectorMenu
        label="Collection"
        heading="Collection"
        menuLabel="Choose collection"
        width={288}
        className="max-w-[20rem] min-w-0 shrink"
        textClassName="text-sm font-semibold"
        value={collectionId ?? ''}
        valueLabel={index.collections.find((c) => c.id === collectionId)?.name ?? 'No binder yet'}
        options={index.collections.map((c) => ({ value: c.id, label: c.name }))}
        action={
          newCollection
            ? {
                label: 'New binder',
                hint: newCollection.hint,
                disabled: newCollection.disabled,
                onSelect: () => newCollection.onSelect(openCreated),
              }
            : undefined
        }
        onSelect={(id) => navigate({ ...visible, main: 'collection', collectionId: id })}
      />
      {visible.main === 'collection' && (
        <SelectorMenu
          label="Collection view"
          heading="View"
          menuLabel="Choose view"
          width={192}
          className="shrink-0"
          textClassName="text-xs font-medium"
          value={collectionState.view}
          valueLabel={VIEW_LABELS[collectionState.view] ?? collectionState.view}
          options={viewOptions}
          onSelect={(view) =>
            navigate({
              ...visible,
              collections: {
                ...visible.collections,
                [collectionId!]: { ...collectionState, view: view as CollectionViewState['view'], scroll: 0 },
              },
            })
          }
        />
      )}
    </div>
  );
  const collection =
    collectionId && index.kind !== 'unavailable'
      ? {
          read: currentRead,
          collectionId,
          state: collectionState,
          highlight,
          onChange: (patch: Partial<CollectionViewState>) =>
            update((old) => ({
              ...old,
              collections: { ...old.collections, [collectionId]: { ...collectionState, ...patch } },
            })),
        }
      : null;
  const content = (
    <>
      {(notice || safe?.notice) && (
        <p role="status" className={styles.notice}>
          {notice || safe?.notice}
        </p>
      )}
      {visible.main === 'inventory' ? (
        <InventoryView
          key={visit}
          scope={scope}
          evidence={index.kind === 'unavailable' ? { kind: 'unavailable' } : currentRead.evidence}
          ownership={ownership}
          savedState={savedState}
          checkPrices={checkPrices}
          catalog={currentRead.catalog}
          layouts={currentRead.layouts}
          onEditGrading={onEditGrading}
          initialBrowseState={visible.inventory}
          onBrowseStateChange={inventoryChange}
          onOpenLocation={(intent) => void openLocation(intent)}
        />
      ) : visible.main === 'dex' ? (
        // oxlint-disable-next-line react-doctor/no-render-in-render -- render prop from the parent, called once per render; it does not define a component, so nothing remounts
        <div key="dex">{renderNationalDex()}</div>
      ) : collectionId && index.kind !== 'unavailable' && collectionState.view === 'slabs' && stagedSlabs ? (
        <SlabsGallery
          key={`${destinationKey}:${visit}:${index.key}`}
          copies={slabCopies}
          name={index.collections.find((c) => c.id === collectionId)?.name ?? 'Collection'}
          cached={index.kind === 'cached'}
          search={collectionState.search}
          onSearch={(search) => collection?.onChange({ search, scroll: 0 })}
        />
      ) : collectionId && index.kind !== 'unavailable' ? (
        <div key={`${destinationKey}:${visit}`}>
          {/* oxlint-disable-next-line react-doctor/no-render-in-render -- render prop from the parent, called once per render; it does not define a component, so nothing remounts */}
          {renderCollection({
            read: currentRead,
            collectionId,
            state: collectionState,
            highlight,
            onChange: (patch) =>
              update((old) => ({
                ...old,
                collections: { ...old.collections, [collectionId]: { ...collectionState, ...patch } },
              })),
          })}
        </div>
      ) : (
        <p role="status">This binder couldn&apos;t be opened. Try Inventory or Browse.</p>
      )}
    </>
  );
  if (renderSurface)
    return renderSurface({
      openCreated,
      notice: notice || safe?.notice || '',
      visit,
      content,
      header,
      state: visible,
      collection,
      onInventory: () => navigate({ ...visible, main: 'inventory' }),
      onBinder: () =>
        navigate(
          collectionId
            ? {
                ...visible,
                main: 'collection',
                collections: { ...visible.collections, [collectionId]: { ...collectionState, view: 'binder' } },
              }
            : { ...visible, main: 'collection' },
        ),
      onDex: () => navigate({ ...visible, main: 'dex', dexView: 'list' }),
      onSlot: (slotId, page) => {
        if (collectionId)
          navigate(
            {
              ...visible,
              main: 'collection',
              collections: {
                ...visible.collections,
                [collectionId]: { ...collectionState, view: 'binder', page, scroll: 0 },
              },
            },
            { collectionId, slotId, open: true },
          );
      },
      onLegacyView: (dexView, requestedSet) =>
        navigate({ ...visible, main: 'dex', dexView, requestedSet: requestedSet ?? null }),
    });
  return (
    <div className={styles.host}>
      <header className={styles.header}>{header}</header>
      {content}
      <nav aria-label="Collection navigation" className={styles.dock}>
        <button
          type="button"
          aria-current={visible.main === 'collection' ? 'page' : undefined}
          disabled={!collectionId}
          onClick={() => navigate({ ...visible, main: 'collection' })}
        >
          Collections
        </button>
        <button
          type="button"
          aria-current={visible.main === 'inventory' ? 'page' : undefined}
          onClick={() => navigate({ ...visible, main: 'inventory' })}
        >
          Inventory
        </button>
        <button
          type="button"
          aria-current={visible.main === 'dex' ? 'page' : undefined}
          onClick={() => navigate({ ...visible, main: 'dex' })}
        >
          National Dex
        </button>
      </nav>
    </div>
  );
}
