'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import NativePageScanner from '@/components/native-page-scanner';
import QuickCardScanner from '@/components/quick-card-scanner';
import { useSlotOfflineQueue } from '@/hooks/use-slot-offline-queue';
import { syntheticSlotPickerSnapshot } from '@/tests/fixtures/slot-picker';
import { readSyntheticComplete } from '@/tests/fixtures/slot-durable-session';
import { pickerCandidate } from '@/lib/slot-picker';
import type { ScanDestinationView } from '@/lib/scan-destinations';

// Synthetic data/detector only. Production scanner components, parser, projection and IndexedDB queue.
const seed = syntheticSlotPickerSnapshot();
seed.inventory.items = [];
seed.inventory.placements = [];
seed.binder.slots.forEach((s) => {
  s.inventoryItemId = null;
  s.status = null;
});
const scope = {
  deviceId: 'synthetic-scan-device',
  workspaceId: 'synthetic-scan-workspace',
  accountId: 'synthetic-account',
  ownerUserId: seed.inventory.ownerUserId,
};
const catalog = (id: string) => {
  const card = seed.cards.find((c) => c.id === id || c.aliasIds?.includes(id));
  return card ? pickerCandidate(card) : undefined;
};

export default function ScanDestinationHarness() {
  const queue = useSlotOfflineQueue(scope, 'synthetic-session');
  const latest = useRef(queue);
  useLayoutEffect(() => {
    latest.current = queue;
  }, [queue]);
  const failOnce = useRef(false),
    unknown = useRef(false),
    deferred = useRef(false);
  const [online, setOnline] = useState(false);
  const [opened, setOpened] = useState<'page' | 'card' | null>(null);
  const [view, setView] = useState<ScanDestinationView>({
    ownerUserId: scope.ownerUserId,
    collectionId: seed.binder.collectionId,
    sessionId: 'synthetic-session',
    rows: 2,
    cols: 4,
    pageSlotIds: seed.binder.slots.map((s) => s.id),
  });
  const [override, setOverride] = useState<typeof seed.inventory | null>(null);
  const [attempts, setAttempts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      const record = await latest.current.queue?.read();
      if (active && record && !record.snapshot)
        await latest.current.saveSnapshot(await readSyntheticComplete(seed.inventory), catalog);
    })().catch(() => {
      if (active) setError('Synthetic initialization failed');
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const change = (event: Event) => {
      const mode = (event as CustomEvent<string>).detail;
      if (mode === 'online') {
        setOnline(true);
        return;
      }
      if (mode === 'fail') {
        failOnce.current = true;
        return;
      }
      if (mode === 'unknown') {
        unknown.current = true;
        return;
      }
      if (mode === 'defer') {
        deferred.current = true;
        return;
      }
      if (mode === 'reorder') {
        const snapshot = structuredClone(latest.current.record!.optimistic!);
        snapshot.binders[0].slots.reverse();
        snapshot.binders[0].layoutRevision++;
        setOverride(snapshot);
        return;
      }
      setView((v) => ({
        ...v,
        ...(mode === 'grid'
          ? { cols: 3 }
          : mode === 'owner'
            ? { ownerUserId: 'other-owner' }
            : { sessionId: 'other-session' }),
      }));
    };
    window.addEventListener('synthetic-scan-control', change);
    return () => window.removeEventListener('synthetic-scan-control', change);
  }, []);
  const snapshot = override ?? queue.record?.optimistic;
  if (!snapshot) return <p role="status">{error ?? queue.error ?? 'Preparing synthetic scan session'}</p>;
  const getOfflineCards = async () => (unknown.current ? [] : seed.cards);
  const admission = {
    snapshot,
    view,
    catalog,
    onCommandIntent: async (
      draft: import('@/lib/binder-slot-editing').StagedSlotCommandIntent,
      scanCatalog: import('@/lib/domain/inventory').InventoryCatalogResolver,
    ) => {
      setAttempts((a) => [...a, draft.intent.request.operationId]);
      if (failOnce.current) {
        failOnce.current = false;
        throw new Error('synthetic-disk-abort');
      }
      return latest.current.enqueue(draft.intent, scanCatalog);
    },
  };
  return (
    <main className="mx-auto max-w-lg space-y-3 px-3 pt-[var(--top-inset)] pb-[var(--dock-clearance)]">
      <h1>Synthetic scan destinations</h1>
      <button className="min-h-11 rounded-xl border p-3" onClick={() => setOpened('page')}>
        Page scan
      </button>{' '}
      <button className="min-h-11 rounded-xl border p-3" onClick={() => setOpened('card')}>
        Card scan
      </button>
      <p>
        Pending: <output aria-label="Pending scan count">{queue.record?.pending.length ?? 0}</output>
      </p>
      <output aria-label="Scan attempts" className="block break-all">
        {attempts.join(',')}
      </output>
      <ul>
        {snapshot.binders[0].slots.map((s) => (
          <li key={s.id}>
            {s.id}: {s.inventoryItemId ?? 'empty'}
          </li>
        ))}
      </ul>
      {opened === 'page' && (
        <NativePageScanner
          admission={{
            ...admission,
            getOfflineCards,
            detectPage: async (_file, rows, cols) => {
              if (deferred.current)
                await new Promise<void>((resolve) =>
                  window.addEventListener('synthetic-scan-release', () => resolve(), { once: true }),
                );
              // Deliberately shuffled detector order, actual row/column coordinates.
              return [
                { index: 5, row: Math.floor(5 / cols), col: 5 % cols, occupied: true },
                { index: 0, row: 0, col: 0, occupied: rows > 0 },
              ];
            },
          }}
          onClose={() => setOpened(null)}
        />
      )}
      {opened === 'card' && (
        <QuickCardScanner
          {...{ getOfflineCards }}
          isOnline={online}
          nativeAdmission={admission}
          onClose={() => setOpened(null)}
          onResult={() => {
            throw new Error('legacy scanner callback must not run');
          }}
        />
      )}
    </main>
  );
}
