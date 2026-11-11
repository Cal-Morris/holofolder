'use client';

import { useEffect, useState } from 'react';
import NavigationHarness from '@/components/collection-navigation/navigation-harness';
import InventoryView from './inventory-view';
import { closeAllOverlays } from '@/hooks/use-overlay';
import type { CompleteInventorySnapshot } from '@/lib/collection/slot-snapshot';
import type { InventoryBrowseEvidence, InventoryLocationIntent } from '@/lib/domain/inventory-browse';
import { inventoryLocationLabel, resolveInventoryLocationIntent } from '@/lib/inventory-location';
import {
  completeInventoryBrowseFixture,
  inventoryBrowseCatalog,
  inventoryBrowseFixture,
  inventoryBrowseLayouts,
  inventoryProjectionFixture,
  inventoryProjectionCatalog,
} from '@/tests/fixtures/inventory-browse';

/** Isolated synthetic host adapter. No account, API, storage, queue or production caller. */
export default function InventoryHarness() {
  const [navigation, setNavigation] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setNavigation(new URLSearchParams(window.location.search).has('navigation')));
  }, []);
  return navigation ? (
    <NavigationHarness slabs={new URLSearchParams(window.location.search).has('slabs')} />
  ) : (
    <InventoryBrowseHarness />
  );
}
function InventoryBrowseHarness() {
  const [snapshot, setSnapshot] = useState<CompleteInventorySnapshot | null>(null);
  const [mode, setMode] = useState('complete');
  const [account, setAccount] = useState('synthetic-owner');
  const [notice, setNotice] = useState('');
  const [projectionDemo, setProjectionDemo] = useState(false);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    void completeInventoryBrowseFixture().then(setSnapshot);
  }, []);
  const layouts = inventoryBrowseLayouts.map((l) => ({
    ...l,
    layoutRevision:
      snapshot?.binders.find((b) => b.collectionId === l.collectionId)?.layoutRevision ?? l.layoutRevision,
    ...(wide ? { rows: 4, cols: 4 } : {}),
  }));
  const scope = {
    accountUserId: account,
    ownerUserId: account === 'synthetic-other' ? 'synthetic-other' : 'synthetic-owner',
  };
  const evidence: InventoryBrowseEvidence =
    !snapshot || mode === 'unavailable'
      ? { kind: 'unavailable' }
      : mode === 'cached'
        ? { kind: 'cached', snapshot }
        : { kind: 'complete', snapshot };
  const open = (intent: InventoryLocationIntent) => {
    // Real host will re-read latest authenticated evidence; this harness only owns synthetic state.
    if (!snapshot || scope.ownerUserId !== snapshot.ownerUserId) return;
    const location = resolveInventoryLocationIntent(snapshot, intent, layouts, mode !== 'cached');
    setNotice(`${intent.itemId}: ${inventoryLocationLabel(location)}`);
  };
  const replace = async (kind: string) => {
    if (!['cached', 'unavailable'].includes(kind)) setProjectionDemo(kind === 'projection');
    if (kind === 'projection') setSnapshot(await completeInventoryBrowseFixture(inventoryProjectionFixture()));
    setMode(kind === 'empty' || kind === 'large' || kind === 'projection' ? 'complete' : kind);
    if (kind === 'empty' || kind === 'large' || kind === 'complete')
      setSnapshot(
        await completeInventoryBrowseFixture(
          inventoryBrowseFixture(kind === 'empty' ? 0 : kind === 'large' ? 1205 : 5),
        ),
      );
  };
  return (
    <main style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <aside
        style={{ padding: '1rem', display: 'grid', gap: '.5rem', borderBottom: '1px solid var(--border)' }}
        aria-label="Synthetic harness controls"
      >
        <strong>Synthetic Inventory harness, read-only</strong>
        <label>
          Evidence{' '}
          <select
            aria-label="Harness evidence"
            style={{ minHeight: 44, width: '100%', fontSize: 16 }}
            value={mode}
            onChange={(e) => void replace(e.target.value)}
          >
            <option value="complete">Complete demo</option>
            <option value="projection">Mixed collection projection</option>
            <option value="cached">Cached only</option>
            <option value="unavailable">Unavailable</option>
            <option value="empty">Empty</option>
            <option value="large">1,205 copies</option>
          </select>
        </label>
        <label>
          Scope{' '}
          <select
            aria-label="Harness account"
            style={{ minHeight: 44, width: '100%', fontSize: 16 }}
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setNotice('');
            }}
          >
            <option value="synthetic-owner">Owner</option>
            <option value="synthetic-partner">Linked partner, same owner</option>
            <option value="synthetic-other">Other account, stale evidence</option>
          </select>
        </label>
        <button style={{ minHeight: 44 }} onClick={() => setWide((v) => !v)}>
          Change grid
        </button>
        <button
          style={{ minHeight: 44 }}
          onClick={() => {
            if (snapshot) {
              const next = structuredClone(snapshot);
              next.inventoryRevision++;
              next.binders[0].layoutRevision++;
              next.binders[0].slots.reverse();
              void completeInventoryBrowseFixture(next).then(setSnapshot);
            }
          }}
        >
          Reverse Alpha slots
        </button>
        <button style={{ minHeight: 44 }} onClick={() => setNotice('Host refreshed without changing evidence')}>
          Refresh host
        </button>
        <output aria-label="Location result" style={{ overflowWrap: 'anywhere' }}>
          {notice}
        </output>
      </aside>
      {snapshot ? (
        <InventoryView
          scope={scope}
          evidence={evidence}
          catalog={projectionDemo ? inventoryProjectionCatalog : inventoryBrowseCatalog}
          layouts={layouts}
          onOpenLocation={open}
        />
      ) : (
        <p>Loading synthetic evidence</p>
      )}
      <nav
        aria-label="Harness dock"
        style={{
          position: 'fixed',
          zIndex: 45,
          bottom: 'var(--dock-inset)',
          height: 'var(--dock-bar)',
          left: 16,
          right: 16,
          background: 'var(--background)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <button style={{ minHeight: 44, width: '100%' }} onClick={closeAllOverlays}>
          Host tab switch
        </button>
      </nav>
    </main>
  );
}
