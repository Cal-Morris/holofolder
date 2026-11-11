'use client';

import { SetChecklistScopePreview } from '@/components/set-preset-picker';
import { collectionDeletionEvidence, type CollectionDeletionDraft } from '@/lib/native-collection-deletion';
import type { InventoryOwnershipBinding } from '@/lib/inventory-actions';
import type { NativeRawRestoreBinding } from '@/lib/native-raw-restore';
import type { NativeBackupBinding } from '@/lib/native-backup';
import { prepareBinderCreation, type BinderCreationDraft } from '@/lib/binder-creation-draft';
import type { NativeBinderCreationBinding } from '@/components/native-binder-creation';
import { shouldOfferBinderOnboarding } from '@/lib/binder-creation-wizard';
import { useBinderOnboarding } from '@/hooks/use-binder-onboarding';

import { recoveryUnresolved } from '@/lib/collection/recovery-rejection';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DatabaseBackup, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { StorageMenu, type StorageMenuAction } from './storage-menu';
import dynamic from 'next/dynamic';
import type { InventorySnapshot } from '@/lib/domain/inventory';
import type { SlotOfflineIntent } from '@/lib/collection/slot-optimistic';
import { inventoryGradingReference, prepareInventoryGradingIntent } from '@/lib/grading/inventory-edit';
import CollectionNavigationHost, { type NavigationSurface } from './navigation-host';
import { useSlotOfflineQueue } from '@/hooks/use-slot-offline-queue';
import {
  CollectionNavigationReadError,
  readCurrentCollectionNavigation,
} from '@/lib/collection/inventory-navigation-read';
import {
  parseNavigationEvidence,
  sameInventoryReadScope,
  type InventoryReadScope,
} from '@/lib/collection/inventory-read-transport';
import type { CollectionNavigationRead } from '@/lib/collection-navigation';
import { getOfflineStore } from '@/lib/offline-store/kv';
import {
  browserHostCatalog,
  browserHostSlotDisplay,
  withSelectedPrintings,
} from '@/lib/collection/browser-host-catalog';
import type { NativeRecoveryBinding } from '@/components/native-activity-recovery';
import type { SlotDisplayInput } from '@/lib/binder-display-model';
import type { SlotCommandSink } from '@/lib/binder-slot-editing';
import { isSlotContractId } from '@/lib/domain/binder-slots';
import { sendStorageCommand } from '@/lib/collection/storage-command-browser';
import type { NativePageScanAdmission } from '@/components/native-page-scanner';
import type { ScanDestinationAdmission } from '@/lib/scan-destinations';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import type { InventoryCatalogResolver } from '@/lib/domain/inventory';
import type { InventoryCatalogEvidence } from '@/lib/domain/inventory-browse';

const NativeCollectionDeletion = dynamic(() => import('@/components/native-collection-deletion'), { ssr: false });
const NativeBackup = dynamic(() => import('@/components/native-backup'), { ssr: false });
const NativeBinderCreation = dynamic(() => import('@/components/native-binder-creation'), { ssr: false });

const GradingEditor = dynamic(() => import('@/components/grading/grading-editor'), { ssr: false });

/** How long a parked edit waits before another round of tries when nothing else prompts one. */
const RETRY_ROUND_PAUSE_MS = 60_000;

export interface BrowserSurfaceBinding {
  nativeConsumer?: Omit<import('@/lib/collection/native-card-consumers').NativeConsumerBinding, 'openCard'>;
  analytics: { scope: import('@/lib/collection-navigation').CollectionNavigationScope; read: CollectionNavigationRead };
  surface: NavigationSurface;
  /** Collection picker and view, shown in one row under the app header. */
  toolbar: ReactNode;
  /** The storage menu, with any host actions (e.g. scanning) listed first. */
  storageMenu: ((extra: StorageMenuAction[]) => ReactNode) | null;
  display?: SlotDisplayInput;
  catalog: InventoryCatalogResolver;
  receive: SlotCommandSink;
  pending: number;
  editingAvailable: boolean;

  bulkFill?: { available: boolean; receive: SlotCommandSink };

  recovery?: NativeRecoveryBinding;

  scan?: {
    detectPage?: NativePageScanAdmission['detectPage'];
    available: boolean;
    online: boolean;
    rows?: number;
    cols?: number;
    sessionId: string;
    getOfflineCards: () => Promise<SearchCardResult[]>;
    receive: ScanDestinationAdmission['onCommandIntent'];
  };
}
/** Runs `run` once when it mounts. It lives in the surface, where the screen's own open action is in hand. */
function StartOnce({ run }: { run: () => void }) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current();
  }, []);
  return null;
}

export default function BrowserCollectionSession({
  scope,
  currentScope,
  renderSurface,
  renderFallback,
  initialBinderId,
  binders,
  localHarness = false,
  displayed,
  onReady,
  onDisplay,
  onStartupFailure,
}: {
  /** The host shows this session; until then it renders nothing and the host's placeholder stays. */
  displayed: boolean;
  onReady: () => void;
  /** This session (by id) has something to paint: its saved copy, a complete read, or a fallback. */
  onDisplay: (sessionId: string) => void;
  onStartupFailure: (error: string) => void;
  initialBinderId: string | null;
  binders?: readonly { id: string; slug?: string | null }[];
  localHarness?: boolean;
  renderFallback: () => ReactNode;
  scope: InventoryReadScope;
  currentScope: () => InventoryReadScope | null;
  renderSurface: (binding: BrowserSurfaceBinding) => ReactNode;
}) {
  // Client-only (ssr: false), so the id is read on the first render: no fallback flash before the session.
  const [device] = useState<{ id: string } | { error: string }>(() => {
    try {
      const key = 'holofolder-slot-device-v1';
      let id = localStorage.getItem(key);
      if (!isSlotContractId(id)) {
        id = crypto.randomUUID();
        localStorage.setItem(key, id);
      }
      return { id };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'device_storage_unavailable' };
    }
  });
  useEffect(() => {
    if ('error' in device) onStartupFailure(device.error);
  }, [device, onStartupFailure]);
  useLayoutEffect(() => {
    if ('error' in device) onDisplay(scope.sessionId);
  }, [device, onDisplay, scope.sessionId]);
  if ('error' in device) return displayed ? renderFallback() : null;
  const deviceId = device.id;
  return (
    <ScopedBrowserSession
      key={JSON.stringify([deviceId, scope.actorUserId, scope.ownerUserId, scope.authSessionId, scope.sessionId])}
      {...{
        scope,
        currentScope,
        renderSurface,
        deviceId,
        initialBinderId,
        binders,
        localHarness,
        displayed,
        onReady,
        onDisplay,
        onStartupFailure,
      }}
    />
  );
}
function ScopedBrowserSession({
  scope,
  currentScope,
  renderSurface,
  deviceId,
  initialBinderId,
  binders,
  localHarness,
  displayed,
  onReady,
  onDisplay,
  onStartupFailure,
}: {
  displayed: boolean;
  onReady: () => void;
  onDisplay: (sessionId: string) => void;
  onStartupFailure: (error: string) => void;
  initialBinderId: string | null;
  binders?: readonly { id: string; slug?: string | null }[];
  localHarness: boolean;
  scope: InventoryReadScope;
  currentScope: () => InventoryReadScope | null;
  deviceId: string;
  renderSurface: (binding: BrowserSurfaceBinding) => ReactNode;
}) {
  const navigationScope = useMemo(
    () => ({ accountUserId: scope.actorUserId, ownerUserId: scope.ownerUserId, sessionId: scope.sessionId }),
    [scope],
  );
  const queue = useSlotOfflineQueue(
    { deviceId, workspaceId: 'holofolder', accountId: scope.actorUserId, ownerUserId: scope.ownerUserId },
    scope.sessionId,
    scope.authSessionId,
  );
  const latest = useRef({
    currentScope,
    queue,
    catalog: browserHostCatalog([]),
    read: null as CollectionNavigationRead | null,
  });
  const consumerAdmission = useRef<import('@/lib/collection/native-card-consumers').NativeConsumerBinding['admit']>(
    () => null,
  );
  const [read, setRead] = useState<CollectionNavigationRead>({
    scope: navigationScope,
    evidence: { kind: 'unavailable' },
    catalog: [],
    layouts: [],
  });
  const [grading, setGrading] = useState<{
    snapshot: InventorySnapshot;
    itemId: string;
    intent: SlotOfflineIntent | null;
  } | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ binding: NativeBinderCreationBinding } | null>(null);
  const creation = useRef<{
    intent: Extract<SlotOfflineIntent, { kind: 'creation' }>;
    opened: boolean;
    open: NavigationSurface['openCreated'];
  } | null>(null);
  const onboarding = useBinderOnboarding(scope.actorUserId);

  const [notice, setNotice] = useState('');
  // The last update did not go through, so what is shown is what this device last saved.
  const [updateFailed, setUpdateFailed] = useState(false);
  // Cards picked in this session that the last read does not know yet: display only, until a read includes them.
  const [picked, setPicked] = useState<readonly InventoryCatalogEvidence[]>([]);
  const kickSender = useRef<() => void>(() => {});
  /** Set when the connection or the app returns, so a parked edit is retried at once instead of after its pause. */
  const resumeNow = useRef(false);
  const completeReadAvailable = useRef(false);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const alive = useRef(false),
    sequence = useRef(0),
    refreshing = useRef(0),
    sending = useRef(false);
  const transport = useRef<AbortController | null>(null);
  const readTransport = useRef<AbortController | null>(null);
  useLayoutEffect(
    () => () => {
      alive.current = false;
      sequence.current++;
      readTransport.current?.abort();
      transport.current?.abort();
    },
    [],
  );
  const metadataKey = `slot-navigation-v1:${JSON.stringify([deviceId, scope.actorUserId, scope.ownerUserId])}`;
  const valid = () => alive.current && sameInventoryReadScope(latest.current.currentScope(), scope);
  const catalog = useMemo(() => browserHostCatalog(read.catalog), [read.catalog]);
  // visibleRead always shares read.catalog, so the binder surface keeps its slot display until the catalog or snapshot changes.
  const displayCatalog = useMemo(() => {
    const fresh = picked.filter(
      (p) => !read.catalog.some((known) => known.card.id === p.card.id && known.card.language === p.card.language),
    );
    return fresh.length ? [...read.catalog, ...fresh] : read.catalog;
  }, [read.catalog, picked]);
  const slotDisplay = useMemo(() => browserHostSlotDisplay(displayCatalog), [displayCatalog]);
  useLayoutEffect(() => {
    latest.current = { currentScope, queue, catalog, read };
  });
  // The latest routine read, so an edit made while it is in flight waits for it instead of failing.
  const inFlightRead = useRef<Promise<CollectionNavigationRead> | null>(null);
  const refresh = () => {
    const read = readFresh();
    inFlightRead.current = read;
    return read;
  };
  const readFresh = async () => {
    if (sending.current) throw new Error('pending-command-read');
    const request = ++sequence.current;
    readTransport.current?.abort();
    const controller = new AbortController();
    readTransport.current = controller;
    refreshing.current++;
    try {
      const fresh = await readCurrentCollectionNavigation(
        () => (valid() ? latest.current.currentScope() : null),
        localHarness,
        controller.signal,
      );
      if (!valid() || request !== sequence.current || fresh.evidence.kind !== 'complete')
        throw new Error('inventory_read_scope_changed');
      // Persist through the canonical queue, which reapplies every unresolved local intent.
      const resolver = browserHostCatalog(fresh.catalog);
      const record = await latest.current.queue.queue?.read();
      if (!valid() || request !== sequence.current) throw new Error('inventory_read_scope_changed');
      // A read older than this device's saved or acknowledged state would roll a saved edit back on screen.
      const floor = Math.max(
        record?.snapshot?.inventoryRevision ?? 0,
        ...(record?.pending.map((p) => p.acknowledgedRevision ?? 0) ?? []),
      );
      if (fresh.evidence.snapshot.inventoryRevision < floor) return fresh;
      const pending =
        record?.pending.some((p) => p.status !== 'acknowledged') || record?.recovery?.some(recoveryUnresolved);
      completeReadAvailable.current = true;
      // Show the read before the queue settles acknowledged edits, so the view never drops back to the old read.
      setRead(fresh);
      setNotice('');
      if (!pending) await latest.current.queue.saveSnapshot(fresh.evidence.snapshot, resolver);
      if (!valid() || request !== sequence.current) throw new Error('inventory_read_scope_changed');
      setUpdateFailed(false);
      await getOfflineStore()?.set(metadataKey, { catalog: fresh.catalog, layouts: fresh.layouts });
      if (valid() && request === sequence.current) onReady();
      return fresh;
    } catch (error) {
      if (valid() && request === sequence.current) {
        completeReadAvailable.current = false;
        setUpdateFailed(true);
        setRead((previous) =>
          previous.evidence.kind === 'complete'
            ? { ...previous, evidence: { kind: 'cached', snapshot: previous.evidence.snapshot } }
            : previous,
        );
        setNotice(
          error instanceof CollectionNavigationReadError &&
            ['inventory_not_initialized', 'legacy_inventory_incomplete'].includes(error.code)
            ? 'Your collection is still being set up on our side. Nothing is lost. Please check back shortly.'
            : navigator.onLine
              ? "Couldn't update just now. Showing what was last saved on this device."
              : '',
        );
      }
      throw error;
    } finally {
      refreshing.current--;
      if (valid() && request === sequence.current) setReady(true);
    }
  };
  useEffect(() => {
    alive.current = true;
    let cachedFinished = false,
      active = true;
    const initial = async () => {
      // The server read starts first; this device's saved copy only fills the wait and never replaces it.
      const startupRequest = sequence.current + 1;
      const network = refresh();
      network.catch(() => {});
      const record = await latest.current.queue.queue?.read();
      const metadata = await getOfflineStore()?.get<{
        catalog: CollectionNavigationRead['catalog'];
        layouts: CollectionNavigationRead['layouts'];
      }>(metadataKey);
      if (!active || !valid()) return;
      if (record?.optimistic) {
        const safeMetadata = record.snapshot ? parseNavigationEvidence(metadata, record.snapshot) : undefined;
        const cached: CollectionNavigationRead = {
          scope: navigationScope,
          evidence: { kind: 'cached', snapshot: record.optimistic },
          catalog: safeMetadata?.catalog ?? [],
          layouts: safeMetadata?.layouts ?? [],
        };
        setRead((previous) => (previous.evidence.kind === 'unavailable' ? cached : previous));
      }
      cachedFinished = true;
      try {
        await network;
      } catch (error) {
        if (active && valid() && sequence.current === startupRequest)
          onStartupFailure(error instanceof Error ? error.message : 'storage_startup_failed');
      }
    };
    void initial().catch((error) => {
      if (active && valid()) {
        onStartupFailure(error instanceof Error ? error.message : 'Saved storage could not be opened');
        setReady(true);
      }
    });
    const disconnected = () => setOnline(false);
    // A read already in flight is current enough; restarting it on every focus meant a slow read never finished.
    const reconnect = () => {
      setOnline(navigator.onLine);
      resumeNow.current = true;
      kickSender.current();
      if (cachedFinished && !refreshing.current && document.visibilityState !== 'hidden')
        void refresh().catch(() => {});
    };
    queueMicrotask(() => setOnline(navigator.onLine));
    window.addEventListener('offline', disconnected);
    window.addEventListener('online', reconnect);
    window.addEventListener('focus', reconnect);
    document.addEventListener('visibilitychange', reconnect);
    const invalidate = () => {
      alive.current = false;
      sequence.current++;
      readTransport.current?.abort();
    };
    return () => {
      active = false;
      invalidate();
      window.removeEventListener('offline', disconnected);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('focus', reconnect);
      document.removeEventListener('visibilitychange', reconnect);
    };
    // A session remount owns the entire read/queue lifetime, never a view change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    transport.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined,
      running = false;
    const active = () => !controller.signal.aborted && valid();
    const tick = async () => {
      if (running) return;
      running = true;
      clearTimeout(timer);
      try {
        if (
          !active() ||
          !completeReadAvailable.current ||
          sending.current ||
          refreshing.current ||
          (await latest.current.queue.queue?.read())?.recovery?.some(recoveryUnresolved) ||
          !navigator.onLine ||
          document.visibilityState === 'hidden'
        )
          return;
        let head = (await latest.current.queue.queue?.read())?.pending[0];
        // After five failed tries the queue parks an edit. An edit whose outcome is simply unknown (the server could
        // not be reached or answered with an error) is picked up again by itself: the same request and operation ID,
        // after a pause, or straight away when the connection or the app comes back. Rejections still wait for a decision.
        if (
          active() &&
          head &&
          head.status === 'unavailable' &&
          head.attempts >= 5 &&
          !head.conflict?.rejected &&
          !(head.lease && head.lease.until > Date.now()) &&
          (resumeNow.current || head.nextAttemptAt + RETRY_ROUND_PAUSE_MS <= Date.now())
        ) {
          await latest.current.queue.queue?.resume(head.intent.request.operationId);
          await latest.current.queue.refresh();
          head = (await latest.current.queue.queue?.read())?.pending[0];
        }
        resumeNow.current = false;
        if (active() && head?.status === 'acknowledged') {
          // Already saved. Settle it from a read that covers its revision, refetching only when needed.
          const current = latest.current.read;
          if (
            current?.evidence.kind === 'complete' &&
            current.evidence.snapshot.inventoryRevision >= head.acknowledgedRevision!
          )
            await latest.current.queue.saveSnapshot(current.evidence.snapshot, latest.current.catalog);
          else await refresh(); // Retries each tick while reads lag the ack; a failed read pauses this until reconnect or focus.
          return;
        }
        if (
          !active() ||
          !head ||
          ['blocked', 'billing', 'conflict'].includes(head.status) ||
          head.attempts >= 5 ||
          head.nextAttemptAt > Date.now() ||
          (head.lease && head.lease.until > Date.now())
        )
          return;
        sending.current = true;
        await latest.current.queue.replay(
          (intent) =>
            sendStorageCommand(
              intent,
              () => (active() ? latest.current.currentScope() : null),
              controller.signal,
              localHarness,
            ),
          latest.current.catalog,
          async () => {
            const fresh = await readCurrentCollectionNavigation(
              () => (active() ? latest.current.currentScope() : null),
              localHarness,
            );
            if (!active() || fresh.evidence.kind !== 'complete') throw new Error('inventory_read_scope_changed');
            completeReadAvailable.current = true;
            setRead(fresh);
            await getOfflineStore()?.set(metadataKey, { catalog: fresh.catalog, layouts: fresh.layouts });
            if (!active()) throw new Error('inventory_read_scope_changed');
            return fresh.evidence.snapshot;
          },
          active,
        );
      } catch {
        if (active())
          setNotice(
            navigator.onLine
              ? "Couldn't sync just now. Your changes are saved on this device and will be sent again."
              : '',
          );
      } finally {
        sending.current = false;
        running = false;
        if (active())
          timer = setTimeout(() => {
            void tick();
          }, 1000);
      }
    };
    // A new edit is sent straight away when online; the timer only retries and catches up after a wait.
    kickSender.current = () => {
      void tick();
    };
    void tick();
    return () => {
      kickSender.current = () => {};
      controller.abort();
      clearTimeout(timer);
    };
    // One sender belongs to this session, independent of view/record refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const reviewConflict = async (decision?: 'keep-remote' | 'rebase') => {
    const q = latest.current.queue.queue,
      head = (await q?.read())?.pending[0];
    if (!q || !head?.conflict?.rejected || !valid() || sending.current) return;
    refreshing.current++;
    try {
      if (head.intent.kind === 'raw-restore') {
        if (decision !== 'keep-remote') return;
        await q.discardRawRestore(
          head.intent.request.operationId,
          async () => {
            const fresh = await readCurrentCollectionNavigation(
              () => (valid() ? latest.current.currentScope() : null),
              localHarness,
            );
            if (!valid() || fresh.evidence.kind !== 'complete') throw new Error('fresh-scoped-read-required');
            setRead(fresh);
            return fresh.evidence.snapshot;
          },
          () =>
            valid()
              ? { deviceId, workspaceId: 'holofolder', accountId: scope.actorUserId, ownerUserId: scope.ownerUserId }
              : null,
          scope.authSessionId,
        );
        if (valid()) {
          await latest.current.queue.refresh();
          setNotice('That restore was discarded. Open Backup to start again.');
        }
        return;
      }
      if (head.intent.kind === 'creation') {
        if (decision !== 'keep-remote') return;
        await q.discardCreation(
          head.intent.request.operationId,
          async () => {
            const fresh = await readCurrentCollectionNavigation(
              () => (valid() ? latest.current.currentScope() : null),
              localHarness,
            );
            if (!valid() || fresh.evidence.kind !== 'complete') throw new Error('fresh-scoped-read-required');
            setRead(fresh);
            return fresh.evidence.snapshot;
          },
          () =>
            valid()
              ? { deviceId, workspaceId: 'holofolder', accountId: scope.actorUserId, ownerUserId: scope.ownerUserId }
              : null,
          scope.authSessionId,
        );
        if (valid()) {
          creation.current = null;
          setCreating(null);
          await latest.current.queue.refresh();
          setNotice("That binder wasn't created. You can start a new one any time.");
        }
        return;
      }
      await q.refreshConflict(
        head.intent.request.operationId,
        async () => {
          const fresh = await readCurrentCollectionNavigation(
            () => (valid() ? latest.current.currentScope() : null),
            localHarness,
          );
          if (!valid() || fresh.evidence.kind !== 'complete') throw new Error('fresh-scoped-read-required');
          setRead(fresh);
          return fresh.evidence.snapshot;
        },
        () =>
          valid()
            ? { deviceId, workspaceId: 'holofolder', accountId: scope.actorUserId, ownerUserId: scope.ownerUserId }
            : null,
      );
      if (!valid()) return;
      if (decision === 'keep-remote')
        await q.reconcile(head.intent.request.operationId, { kind: 'keep-remote' }, latest.current.catalog);
      if (decision === 'rebase')
        await q.rebase(head.intent.request.operationId, crypto.randomUUID(), latest.current.catalog);
      if (valid()) {
        await latest.current.queue.refresh();
        setNotice(decision ? '' : 'Your collection is up to date. Your change is still waiting for you to decide.');
      }
    } catch {
      if (valid())
        setNotice(
          head.intent.kind === 'creation'
            ? "Couldn't discard that just now. Check your connection and try again."
            : "That change can't be applied on top of the newer changes. You can keep your collection as it is, then make the change again.",
        );
    } finally {
      refreshing.current--;
    }
  };
  const scanAllowed = useRef(false);
  useLayoutEffect(() => {
    scanAllowed.current =
      online &&
      read.evidence.kind === 'complete' &&
      !!queue.record &&
      !queue.record.pending.length &&
      !queue.record.recovery?.some(recoveryUnresolved);
  });
  const receiveScan: ScanDestinationAdmission['onCommandIntent'] = async (draft, scanCatalog) => {
    if (
      !valid() ||
      refreshing.current ||
      !scanAllowed.current ||
      !navigator.onLine ||
      draft.scope.ownerUserId !== scope.ownerUserId ||
      draft.intent.kind !== 'inventory' ||
      read.evidence.kind !== 'complete' ||
      !read.evidence.snapshot.binders.some((b) => b.collectionId === draft.scope.collectionId)
    )
      throw new Error('fresh-scoped-read-required');
    const record = await latest.current.queue.queue?.read();
    if (
      !valid() ||
      !scanAllowed.current ||
      !navigator.onLine ||
      !record ||
      record.pending.length ||
      record.recovery?.some(recoveryUnresolved)
    )
      throw new Error('fresh-scoped-read-required');
    return latest.current.queue.enqueue(draft.intent, scanCatalog, undefined, valid);
  };
  const getOfflineCards = async () => {
    const { buildOfflineCardIndex } = await import('@/lib/offline-card-index');
    const cached = await buildOfflineCardIndex([]);
    if (!valid()) throw new Error('inventory_read_scope_changed');
    const cards = read.catalog.map((c) => ({ ...c.card, dexIds: [...(c.pokemonIds ?? [])] }));
    return [
      ...cards,
      ...cached.filter((c) => !cards.some((known) => known.id === c.id && known.language === c.language)),
    ];
  };
  const pendingCount = queue.record?.pending.length ?? 0;
  useEffect(() => {
    if (pendingCount) kickSender.current();
  }, [pendingCount]);
  const receive: SlotCommandSink = async (draft, selected, pickedCard) => {
    // A focus or visibility refresh is routine; every fence below still applies to the read it settles on.
    const current = refreshing.current && inFlightRead.current ? await inFlightRead.current.catch(() => null) : read;
    if (
      !current ||
      refreshing.current ||
      !completeReadAvailable.current ||
      !valid() ||
      draft.scope.ownerUserId !== scope.ownerUserId
    )
      throw new Error('inactive-or-unavailable-session');
    const record = await latest.current.queue.queue?.read();
    // Edits queue behind ones still syncing: the queue projects each onto the last and sends them in order.
    if (!valid() || current.evidence.kind !== 'complete' || !record || record.recovery?.some(recoveryUnresolved))
      throw new Error('fresh-scoped-read-required');
    const host = current === read ? catalog : browserHostCatalog(current.catalog);
    if (pickedCard)
      setPicked((previous) => [
        ...previous.filter((p) => p.card.id !== pickedCard.card.id || p.card.language !== pickedCard.card.language),
        pickedCard,
      ]);
    return latest.current.queue.enqueue(
      draft.intent,
      withSelectedPrintings(host, current.catalog, selected),
      undefined,
      valid,
    );
  };

  const receiveBulkFill: SlotCommandSink = async (draft) => {
    if (
      refreshing.current ||
      !completeReadAvailable.current ||
      !valid() ||
      draft.scope.ownerUserId !== scope.ownerUserId ||
      draft.intent.kind !== 'inventory'
    )
      throw new Error('inactive-or-unavailable-session');
    // #469 adds recovery to this same record; unresolved recovery must fence new work.
    const record:
      { pending: unknown[]; recovery?: { synchronized: boolean; resolution?: 'discarded' | null }[] } | undefined =
      await latest.current.queue.queue?.read();
    if (
      !valid() ||
      !navigator.onLine ||
      read.evidence.kind !== 'complete' ||
      !record ||
      record.pending.length ||
      record.recovery?.some(recoveryUnresolved)
    )
      throw new Error('fresh-scoped-read-required');
    return latest.current.queue.enqueue(draft.intent, catalog, undefined, valid);
  };

  useLayoutEffect(() => {
    consumerAdmission.current = () => {
      const record = latest.current.queue.record;
      if (
        !valid() ||
        !completeReadAvailable.current ||
        !navigator.onLine ||
        refreshing.current ||
        sending.current ||
        read.evidence.kind !== 'complete' ||
        !record ||
        record.pending.length ||
        record.legacy.length ||
        record.recovery?.some(recoveryUnresolved)
      )
        return null;
      return {
        scope: navigationScope,
        read,
        context: {
          source: 'app',
          clientId: deviceId,
          operationId: crypto.randomUUID(),
          batchId: null,
          clientOccurredAt: new Date().toISOString(),
        },
        receive,
      };
    };
    return () => {
      consumerAdmission.current = () => null;
    };
  });

  const recoveryRead = useRef<CollectionNavigationRead | null>(null);
  const recovery: NativeRecoveryBinding = {
    queue: queue.queue,
    deviceId,
    localHarness,
    scope,
    currentScope: () => (valid() ? latest.current.currentScope() : null),
    activeQueueScope: () =>
      valid()
        ? { deviceId, workspaceId: 'holofolder', accountId: scope.actorUserId, ownerUserId: scope.ownerUserId }
        : null,
    snapshot: read.evidence.kind === 'unavailable' ? null : read.evidence.snapshot,
    refresh: async () => {
      await latest.current.queue.refresh();
      const record = await latest.current.queue.queue?.read();
      if (!record?.recovery?.some(recoveryUnresolved)) {
        if (valid() && recoveryRead.current) {
          setRead(recoveryRead.current);
          recoveryRead.current = null;
        } else await refresh();
      }
    },
    readCurrent: async () => {
      if (sending.current || refreshing.current || !valid())
        throw new Error('Storage is busy. Retry when current reads finish.');
      refreshing.current++;
      try {
        const fresh = await readCurrentCollectionNavigation(
          () => (valid() ? latest.current.currentScope() : null),
          localHarness,
        );
        if (!valid() || fresh.evidence.kind !== 'complete') throw new Error('fresh-scoped-read-required');
        // Publish only after the queue accepts this fresh snapshot; preview does not alter display.
        recoveryRead.current = fresh;
        return fresh.evidence.snapshot;
      } finally {
        refreshing.current--;
      }
    },
  };
  const assertBackupReady = async () => {
    if (!valid() || !navigator.onLine || sending.current || refreshing.current)
      throw new Error('Reconnect and wait for current storage before exporting.');
    const record = await latest.current.queue.queue?.read();
    if (
      !valid() ||
      !navigator.onLine ||
      sending.current ||
      refreshing.current ||
      !record ||
      record.pending.length ||
      record.legacy.length ||
      record.recovery?.some(recoveryUnresolved)
    ) {
      throw new Error('Finish pending edits, creation or recovery before exporting or comparing a preview.');
    }
  };
  const backupBinding: NativeBackupBinding = {
    scope,
    currentScope: () => (valid() ? latest.current.currentScope() : null),
    available:
      online &&
      read.evidence.kind === 'complete' &&
      !!queue.record &&
      !queue.record.pending.length &&
      !queue.record.legacy.length &&
      !queue.record.recovery?.some(recoveryUnresolved),
    revisionKey:
      read.evidence.kind === 'unavailable'
        ? 'unavailable'
        : JSON.stringify([read.evidence.snapshot.inventoryRevision, read.layouts, read.partnerUserId]),
    assertReady: assertBackupReady,
    readCurrent: async () => {
      await assertBackupReady();
      refreshing.current++;
      try {
        return await readCurrentCollectionNavigation(
          () => (valid() ? latest.current.currentScope() : null),
          localHarness,
        );
      } finally {
        refreshing.current--;
      }
    },
  };
  const restoreBinding: NativeRawRestoreBinding = {
    plan: async (input, active) => {
      const { requestNativeRawRestorePlan } = await import('@/lib/native-raw-restore');
      return requestNativeRawRestorePlan(backupBinding, input, active, localHarness);
    },
    retain: async (command, base, active) => {
      await assertBackupReady();
      if (
        !active() ||
        !valid() ||
        sending.current ||
        refreshing.current ||
        read.evidence.kind !== 'complete' ||
        command.planning.authSessionId !== scope.authSessionId
      )
        throw new Error('fresh-scoped-read-required');
      // A current complete read supplies the atomic queue base, never a file or cached DTO.
      const fresh = await refresh();
      const grid = fresh.layouts.find((l) => l.collectionId === command.collection.collectionId);
      if (
        !active() ||
        !valid() ||
        fresh.partnerUserId !== command.planning.partnerUserId ||
        !grid ||
        grid.rows !== command.configuration.rows ||
        grid.cols !== command.configuration.cols ||
        grid.layoutRevision !== command.collection.layoutRevision ||
        fresh.evidence.kind !== 'complete' ||
        fresh.evidence.snapshot.inventoryRevision !== base.inventoryRevision ||
        command.inventoryRevision !== fresh.evidence.snapshot.inventoryRevision
      )
        throw new Error('Restore review changed. Reopen Backup.');
      const { rawRestoreIntent } = await import('@/lib/native-raw-restore');
      return latest.current.queue.enqueue(
        rawRestoreIntent(command, deviceId),
        latest.current.catalog,
        fresh.evidence.snapshot,
        () => valid() && active(),
      );
    },
  };
  // An optimistic projection is cached evidence, never a complete remote read or ACK.
  // Display only: a just-picked card keeps its name and artwork here; identity checks still use the read's own catalog.
  const shownRead = useMemo(
    () => (displayCatalog === read.catalog ? read : { ...read, catalog: displayCatalog }),
    [read, displayCatalog],
  );
  const visibleRead: CollectionNavigationRead =
    queue.record?.optimistic && queue.record.pending.length
      ? {
          ...shownRead,
          evidence: { kind: 'cached', snapshot: queue.record.optimistic },
          layouts: read.layouts.map((layout) => {
            const base = queue.record?.snapshot?.binders.find((b) => b.collectionId === layout.collectionId);
            const projected = queue.record?.optimistic?.binders.find((b) => b.collectionId === layout.collectionId);
            return base?.layoutRevision === layout.layoutRevision && projected
              ? { ...layout, layoutRevision: projected.layoutRevision }
              : layout;
          }),
        }
      : !online && read.evidence.kind === 'complete'
        ? { ...shownRead, evidence: { kind: 'cached', snapshot: read.evidence.snapshot } }
        : shownRead;
  // Acknowledged edits are saved; they stay queued only until a read covers them.
  const unsaved = queue.record?.pending.filter((p) => p.status !== 'acknowledged').length ?? 0;
  const inventoryRecord: {
    pending: unknown[];
    recovery?: { synchronized: boolean; resolution?: 'discarded' | null }[];
  } | null = queue.record;
  const bulkFillAvailable = Boolean(
    online &&
    read.evidence.kind === 'complete' &&
    inventoryRecord &&
    !inventoryRecord.pending.length &&
    !inventoryRecord.recovery?.some(recoveryUnresolved),
  );

  const ownershipReady = useRef(false);
  const ownershipRevision = useRef<number | null>(null);
  useLayoutEffect(() => {
    ownershipReady.current =
      bulkFillAvailable && !queue.record?.legacy.length && (!creation.current || creation.current.opened);
    ownershipRevision.current = read.evidence.kind === 'complete' ? read.evidence.snapshot.inventoryRevision : null;
  });
  const ownership: InventoryOwnershipBinding | undefined =
    read.evidence.kind === 'complete'
      ? {
          snapshot: read.evidence.snapshot,
          catalog,
          available:
            bulkFillAvailable && !queue.record?.legacy.length && (!creation.current || creation.current.opened),
          receive: async (intent, selectedCatalog) => {
            if (
              !valid() ||
              !ownershipReady.current ||
              refreshing.current ||
              sending.current ||
              !navigator.onLine ||
              intent.request.inventoryRevision !== ownershipRevision.current ||
              (creation.current && !creation.current.opened)
            )
              throw new Error('fresh-scoped-read-required');
            const record = await latest.current.queue.queue?.read();
            if (
              !valid() ||
              !ownershipReady.current ||
              !navigator.onLine ||
              !record ||
              record.pending.length ||
              record.legacy.length ||
              record.recovery?.some(recoveryUnresolved) ||
              record.snapshot?.inventoryRevision !== intent.request.inventoryRevision
            )
              throw new Error('pending-reconciliation');
            const fresh = await refresh();
            if (
              !valid() ||
              !navigator.onLine ||
              fresh.evidence.kind !== 'complete' ||
              fresh.evidence.snapshot.inventoryRevision !== intent.request.inventoryRevision
            )
              throw new Error('ownership-review-changed');
            const current = await latest.current.queue.queue?.read();
            if (
              !valid() ||
              !ownershipReady.current ||
              sending.current ||
              refreshing.current ||
              !navigator.onLine ||
              !current ||
              current.pending.length ||
              current.legacy.length ||
              current.recovery?.some(recoveryUnresolved) ||
              current.snapshot?.inventoryRevision !== intent.request.inventoryRevision
            )
              throw new Error('pending-reconciliation');
            return latest.current.queue.enqueue(
              intent,
              selectedCatalog,
              fresh.evidence.snapshot,
              () =>
                valid() && navigator.onLine && ownershipReady.current && (!creation.current || creation.current.opened),
            );
          },
        }
      : undefined;

  const deletionAvailable = bulkFillAvailable && !queue.record?.legacy.length;
  const receiveDeletion = async (draft: CollectionDeletionDraft) => {
    if (!valid() || refreshing.current || sending.current || !navigator.onLine)
      throw new Error('fresh-scoped-read-required');
    const record = await latest.current.queue.queue?.read();
    if (
      !valid() ||
      !record ||
      record.pending.length ||
      record.legacy.length ||
      record.recovery?.some(recoveryUnresolved)
    )
      throw new Error('pending-reconciliation');
    // Reauthenticate membership/default and every current revision before durable acceptance.
    const fresh = await refresh();
    if (
      !valid() ||
      !navigator.onLine ||
      collectionDeletionEvidence(fresh) !== draft.evidence ||
      fresh.evidence.kind !== 'complete'
    )
      throw new Error('deletion-review-changed');
    return latest.current.queue.enqueue(
      draft.intent,
      latest.current.catalog,
      fresh.evidence.snapshot,
      () => valid() && navigator.onLine,
    );
  };
  const creationAvailable = bulkFillAvailable && !queue.record?.legacy.length && read.evidence.kind === 'complete';
  const create = async (
    draft: BinderCreationDraft,
    open: NavigationSurface['openCreated'],
    grid: { rows: number; cols: number } | null = null,
  ) => {
    if (!valid() || refreshing.current || sending.current || !navigator.onLine || read.evidence.kind !== 'complete')
      throw new Error('fresh-scoped-read-required');
    const record = await latest.current.queue.queue?.read();
    if (
      !valid() ||
      !record ||
      record.pending.length ||
      record.legacy.length ||
      record.recovery?.some(recoveryUnresolved)
    )
      throw new Error('pending-reconciliation');
    if (creation.current?.intent.request.operationId !== draft.operationId) {
      creation.current = {
        intent: prepareBinderCreation(
          draft,
          read.evidence.snapshot,
          {
            source: 'app',
            clientId: deviceId,
            operationId: draft.operationId,
            batchId: null,
            clientOccurredAt: new Date().toISOString(),
          },
          crypto.randomUUID(),
          draft.manifest.entries.map(() => crypto.randomUUID()),
          grid,
        ),
        open,
        opened: false,
      };
    }
    return latest.current.queue.enqueue(creation.current.intent, latest.current.catalog, read.evidence.snapshot, valid);
  };
  useEffect(() => {
    const retained = creation.current;
    if (
      !retained ||
      retained.opened ||
      !valid() ||
      read.evidence.kind !== 'complete' ||
      !queue.record?.receipts.some(
        (r) => r.operationId === retained.intent.request.operationId && r.outcome === 'acknowledged',
      ) ||
      queue.record.pending.length ||
      queue.record.recovery?.some(recoveryUnresolved)
    )
      return;
    retained.opened = true;
    setCreating(null);
    // Historical receipts do not establish presence, and a later navigation owns the screen.
    if (queue.record.snapshot?.collections.some((c) => c.id === retained.intent.request.collectionId))
      retained.open(retained.intent.request.collectionId, read);
    // The exact creation is consumed at most once in this mounted session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.record, read]);
  const startCreation = (
    open: NavigationSurface['openCreated'],
    currentGrid?: { rows: number; cols: number },
    firstRun = false,
  ) =>
    setCreating({
      binding: {
        actorUserId: scope.actorUserId,
        ownerUserId: scope.ownerUserId,
        count: read.evidence.kind === 'unavailable' ? 0 : read.evidence.snapshot.collections.length,
        available: creationAvailable,
        onboarding: firstRun,
        currentGrid: currentGrid ? { rows: currentGrid.rows, cols: currentGrid.cols } : undefined,
        create: (draft, grid) => create(draft, open, grid),
      },
    });
  // First run: a new account with nothing set up gets the wizard once, as soon as it can create. Shown counts as seen.
  const offerOnboarding =
    onboarding.due &&
    !creating &&
    creationAvailable &&
    read.evidence.kind === 'complete' &&
    shouldOfferBinderOnboarding(read.evidence.snapshot, scope.actorUserId);
  const displayable = ready || read.evidence.kind !== 'unavailable';
  useLayoutEffect(() => {
    if (displayable) onDisplay(scope.sessionId);
  }, [displayable, onDisplay, scope.sessionId]);
  // This device's saved copy paints at once and stays read-only (cached evidence) until the read completes.
  if (!displayable || !displayed) return null;
  const gradingItem = grading?.snapshot.items.find((i) => i.id === grading.itemId);
  const canEditGrading =
    read.evidence.kind === 'complete' &&
    !queue.record?.pending.length &&
    !queue.record?.recovery?.some(recoveryUnresolved);
  return (
    <>
      <CollectionNavigationHost
        ownership={ownership}
        onEditGrading={
          canEditGrading
            ? (itemId) => {
                if (
                  !valid() ||
                  read.evidence.kind !== 'complete' ||
                  latest.current.queue.record?.pending.length ||
                  latest.current.queue.record?.recovery?.some(recoveryUnresolved)
                )
                  return;
                try {
                  inventoryGradingReference(read.evidence.snapshot, itemId);
                  setGrading({ snapshot: structuredClone(read.evidence.snapshot), itemId, intent: null });
                } catch {
                  setNotice(
                    "Grading can't be edited until your collection has finished updating. Try again in a moment.",
                  );
                }
              }
            : undefined
        }
        savedState={!online ? 'offline' : updateFailed ? 'last-saved' : 'updating'}
        newCollection={{
          disabled: !creationAvailable,
          hint: creationAvailable
            ? undefined
            : online
              ? 'Available once your latest changes are saved'
              : "Available when you're back online",
          onSelect: (open) => startCreation(open),
        }}
        stagedSlabs
        scope={navigationScope}
        binders={binders}
        fallbackCollectionId={read.defaultCollectionId ?? initialBinderId}
        read={visibleRead}
        readCurrent={async () => {
          const fresh = await refresh();
          const record = await latest.current.queue.queue?.read();
          if (record?.pending.length || record?.recovery?.some(recoveryUnresolved))
            throw new Error('pending-layout-reconciliation');
          return fresh;
        }}
        scrollContainerId="collection-browser-scroll"

        renderNationalDex={() => null}
        renderCollection={() => null}
        renderSurface={(surface) => {
          const snapshot = visibleRead.evidence.kind === 'unavailable' ? null : visibleRead.evidence.snapshot;
          const binder = snapshot?.binders.find((b) => b.collectionId === surface.collection?.collectionId);
          // Cached slots may be displayed, but current pages require a matching saved grid.
          const layout =
            binder &&
            visibleRead.layouts.find(
              (l) => l.collectionId === binder.collectionId && l.layoutRevision === binder.layoutRevision,
            );
          const display = snapshot && binder && layout ? slotDisplay(snapshot, binder) : undefined;
          const head = queue.record?.pending[0];
          // The first change that has not been accepted yet. Accepted ones ahead of it are already saved.
          const waiting = queue.record?.pending.find((p) => p.status !== 'acknowledged');
          // Sends that change again as the exact request it already is: same bytes, same operation ID.
          const retryWaiting = () => {
            const current = latest.current.queue.record?.pending.find((p) => p.status !== 'acknowledged');
            if (!current || !valid()) return;
            void latest.current.queue.queue
              ?.resume(current.intent.request.operationId)
              .then(() => latest.current.queue.refresh())
              .then(() => kickSender.current())
              .catch(() => {
                if (valid()) setNotice('Still working on it. Your change is saved on this device.');
              });
          };
          return (
            <>
              {deleting && (
                <NativeCollectionDeletion
                  key={`${scope.sessionId}:${deleting}`}
                  collectionId={deleting}
                  binding={{ read, available: deletionAvailable, receive: receiveDeletion }}
                  onClose={() => setDeleting(null)}
                />
              )}
              {backupOpen && (
                <NativeBackup
                  key={`${scope.sessionId}:${surface.state.collectionId}:${surface.state.main}`}
                  binding={backupBinding}
                  restore={restoreBinding}
                  collectionId={surface.state.collectionId}
                  onClose={() => setBackupOpen(false)}
                />
              )}
              {renderSurface({
                nativeConsumer: {
                  scope: navigationScope,
                  read: visibleRead,
                  collectionId:
                    surface.state.main === 'inventory'
                      ? surface.state.inventory.query.collectionId || undefined
                      : (surface.state.collectionId ?? undefined),
                  editingAvailable: bulkFillAvailable && !queue.record?.legacy.length,
                  admit: () => consumerAdmission.current(),
                },
                analytics: { scope: navigationScope, read: visibleRead },
                toolbar: surface.header,
                storageMenu: (extra) => (
                  <StorageMenu
                    attention={Boolean(queue.record?.recovery?.some(recoveryUnresolved))}
                    actions={[
                      ...extra,
                      { label: 'Backup', icon: DatabaseBackup, separated: true, onSelect: () => setBackupOpen(true) },
                      {
                        label: 'New binder',
                        icon: Plus,
                        disabled: !creationAvailable,
                        onSelect: () => startCreation(surface.openCreated, layout),
                      },
                      {
                        label: 'Refresh',
                        icon: RefreshCw,
                        disabled: !online,
                        onSelect: () => {
                          void refresh().catch(() => {});
                        },
                      },
                      ...(surface.state.main === 'collection' && surface.state.collectionId
                        ? [
                            {
                              label:
                                snapshot?.collections.find((c) => c.id === surface.state.collectionId)?.kind ===
                                'binder'
                                  ? 'Delete this binder'
                                  : 'Delete this collection',
                              icon: Trash2,
                              danger: true,
                              separated: true,
                              disabled: !deletionAvailable,
                              onSelect: () => setDeleting(surface.state.collectionId),
                            },
                          ]
                        : []),
                    ]}
                  >
                    {surface.state.main === 'collection' && binder?.presetManifest?.setScope && (
                      <details className="rounded-xl px-3">
                        <summary className="min-h-11 cursor-pointer py-3 font-medium">
                          What this set binder covers
                        </summary>
                        <div className="max-h-48 overflow-y-auto pb-3">
                          <SetChecklistScopePreview
                            checklist={{ manifest: binder.presetManifest, scope: binder.presetManifest.setScope }}
                            binder={binder}
                          />
                        </div>
                      </details>
                    )}
                  </StorageMenu>
                ),
                surface: {
                  ...surface,
                  header: (
                    <>
                      {queue.record?.recovery?.some(recoveryUnresolved) && (
                        <p role="status" className="px-4 text-sm">
                          An undo didn&apos;t finish. Open Activity from the manage menu to check it.
                        </p>
                      )}
                      {/* A change that is on its way needs no line. Only say something when it is waiting on something. */}
                      {/* An accepted change is saved: it stays queued only until a read covers it, and needs no line either. */}
                      {waiting &&
                        !waiting.conflict?.rejected &&
                        !['conflict', 'blocked', 'billing'].includes(waiting.status) &&
                        (!online ? (
                          <p role="status" data-sync-state="offline" className="text-muted-foreground px-4 text-sm">
                            Saved on this device. It&apos;ll sync when you&apos;re back online.
                          </p>
                        ) : (
                          waiting.status === 'unavailable' && (
                            <p role="status" data-sync-state="retrying" className="text-muted-foreground px-4 text-sm">
                              Couldn&apos;t save your latest change yet. Trying again…
                              <button type="button" className="ml-2 min-h-9 underline" onClick={retryWaiting}>
                                Try now
                              </button>
                            </p>
                          )
                        ))}
                      {head && ['conflict', 'blocked', 'billing'].includes(head.status) && !head.conflict?.rejected && (
                        <p role="status" className="px-4 text-sm">
                          {head.status === 'conflict'
                            ? 'Your collection changed somewhere else, so your latest change is on hold. Nothing is lost.'
                            : head.status === 'billing'
                              ? 'Syncing is paused until your plan is active again. Your change is saved on this device.'
                              : "Syncing is paused. Your change is saved on this device. Check you're signed in to the right account."}
                          {/* A paused change is never sent again by itself: it waits for this, with the same request as before. */}
                          <button type="button" className="ml-2 min-h-9 underline" onClick={retryWaiting}>
                            Try again
                          </button>
                        </p>
                      )}
                      {head?.intent.kind === 'raw-restore' &&
                        head.conflict?.rejected &&
                        head.intent.request.planning.authSessionId === scope.authSessionId && (
                          <div className="px-4 text-sm">
                            <p>That restore wasn&apos;t applied. Discard it, then open Backup to start again.</p>
                            <button
                              type="button"
                              className="min-h-9 pr-4 underline"
                              disabled={!online}
                              onClick={() => {
                                void reviewConflict('keep-remote');
                              }}
                            >
                              Discard restore
                            </button>
                          </div>
                        )}
                      {head?.intent.kind === 'creation' &&
                        head.conflict?.rejected &&
                        head.creationAuthSessionId === scope.authSessionId && (
                          <div className="px-4 text-sm">
                            <p>That binder wasn&apos;t created. Discard it, then make a new one.</p>
                            <button
                              type="button"
                              className="min-h-9 pr-4 underline"
                              disabled={!online}
                              onClick={() => {
                                void reviewConflict('keep-remote');
                              }}
                            >
                              Discard
                            </button>
                          </div>
                        )}
                      {head &&
                        head.intent.kind !== 'creation' &&
                        head.intent.kind !== 'raw-restore' &&
                        head.conflict?.rejected && (
                          <div className="px-4 text-sm">
                            <p>
                              Your last change wasn&apos;t applied because your collection had changed. What would you
                              like to do?
                            </p>
                            {head.conflict.current && queue.record?.pending.length === 1 ? (
                              <>
                                <button
                                  type="button"
                                  className="min-h-9 pr-4 underline"
                                  onClick={() => {
                                    void reviewConflict('keep-remote');
                                  }}
                                >
                                  Keep my collection as it is
                                </button>
                                <button
                                  type="button"
                                  className="min-h-9 pr-4 underline"
                                  onClick={() => {
                                    void reviewConflict('rebase');
                                  }}
                                >
                                  Apply my change again
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="min-h-9 pr-4 underline"
                                onClick={() => {
                                  void reviewConflict();
                                }}
                              >
                                Check my collection
                              </button>
                            )}
                          </div>
                        )}
                      {read.evidence.kind === 'complete' && !read.evidence.snapshot.collections.length && (
                        <div className="border-border/60 bg-card/70 mx-4 my-2 rounded-2xl border p-4 text-center">
                          <p className="text-sm font-semibold">Start your first binder</p>
                          <p className="text-muted-foreground mt-1 text-sm">
                            Pick what it&apos;s for, give it a name and you&apos;re ready to add cards.
                          </p>
                          <button
                            type="button"
                            disabled={!creationAvailable}
                            onClick={() => startCreation(surface.openCreated)}
                            className="bg-primary text-primary-foreground mt-3 min-h-11 rounded-2xl px-5 text-sm font-semibold disabled:opacity-45"
                          >
                            New binder
                          </button>
                        </div>
                      )}
                      {offerOnboarding && (
                        <StartOnce
                          run={() => {
                            onboarding.finish();
                            startCreation(surface.openCreated, layout, true);
                          }}
                        />
                      )}
                      {(notice || queue.error) && (
                        <p role="status" className="px-4 text-sm">
                          {notice ||
                            (queue.error?.startsWith('Saved on device')
                              ? 'Saved. The view will catch up in a moment.'
                              : "This device can't save changes right now. Check its storage, then reload.")}
                        </p>
                      )}

                      {surface.state.main !== 'inventory' && surface.notice && (
                        <p role="status" className="px-4 text-sm">
                          {surface.notice}
                        </p>
                      )}
                    </>
                  ),
                },
                display,
                catalog,
                receive,
                recovery,
                editingAvailable:
                  read.evidence.kind === 'complete' &&
                  !queue.record?.recovery?.some(recoveryUnresolved) &&
                  !queue.record?.pending.some((p) => p.intent.kind === 'creation' || p.intent.kind === 'raw-restore'),
                bulkFill: { available: bulkFillAvailable, receive: receiveBulkFill },
                pending: unsaved,

                scan: {
                  detectPage:
                    localHarness && new URLSearchParams(location.search).get('scanFixture') === '1'
                      ? async (...args) =>
                          (await import('@/tests/fixtures/native-scanner-host')).syntheticPageDetection(...args)
                      : undefined,
                  available: bulkFillAvailable,
                  online,
                  rows: layout?.rows,
                  cols: layout?.cols,
                  sessionId: scope.sessionId,
                  getOfflineCards,
                  receive: receiveScan,
                },
              })}
            </>
          );
        }}
      />
      {creating && (
        <NativeBinderCreation
          binding={{
            ...creating.binding,
            available: creationAvailable,
            count: read.evidence.kind === 'unavailable' ? 0 : read.evidence.snapshot.collections.length,
          }}
          onClose={() => setCreating(null)}
        />
      )}
      {grading &&
        gradingItem &&
        read.evidence.kind === 'complete' &&
        read.evidence.snapshot.inventoryRevision === grading.snapshot.inventoryRevision && (
          <GradingEditor
            key={`${scope.sessionId}:${grading.itemId}:${gradingItem.version}`}
            item={gradingItem}
            itemRef={inventoryGradingReference(grading.snapshot, grading.itemId)}
            ownerEvidence={grading.snapshot.items}
            onClose={() => setGrading((current) => (current === grading ? null : current))}
            onQueue={async (command) => {
              if (!valid() || refreshing.current)
                throw new Error(
                  'The authenticated storage session changed. Your accepted edits remain on this device.',
                );
              const record = await latest.current.queue.queue?.read();
              if (
                !valid() ||
                read.evidence.kind !== 'complete' ||
                !record ||
                record.pending.length ||
                record.recovery?.some(recoveryUnresolved)
              )
                throw new Error('fresh-scoped-read-required');
              // Allocate once before touching IDB. An aborted/lost local reply retries these exact bytes.
              grading.intent ??= prepareInventoryGradingIntent(grading.snapshot, command, {
                source: 'app',
                clientId: deviceId,
                operationId: crypto.randomUUID(),
                batchId: null,
                clientOccurredAt: new Date().toISOString(),
              });
              return latest.current.queue.enqueue(grading.intent, latest.current.catalog, undefined, valid);
            }}
          />
        )}
    </>
  );
}
