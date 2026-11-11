'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LayoutToolbar, type LayoutTap } from '@/components/binder/layout-editor';
import { OrderedSlot } from '@/components/binder/ordered-slot';
import { buildSlotDisplay } from '@/lib/binder-display-model';
import { useSlotOfflineQueue } from '@/hooks/use-slot-offline-queue';
import { syntheticSlotPickerSnapshot } from '@/tests/fixtures/slot-picker';
import { readSyntheticComplete } from '@/tests/fixtures/slot-durable-session';
import { pickerCandidate } from '@/lib/slot-picker';
import { projectSlotIntent } from '@/lib/collection/slot-optimistic';
import type { SlotCommandSink } from '@/lib/binder-slot-editing';

// Hard-gated synthetic identity/catalog/transport, real queue and IndexedDB transaction acceptance.
const seed = syntheticSlotPickerSnapshot();
const catalog = (id: string) => {
  const c = seed.cards.find((c) => c.id === id);
  return c ? pickerCandidate(c) : undefined;
};
const scope = {
  deviceId: 'synthetic-bulk-device',
  workspaceId: 'synthetic-bulk-workspace',
  accountId: 'synthetic-bulk-account',
  ownerUserId: seed.inventory.ownerUserId,
};
const controlClass = 'min-h-10 rounded-xl border border-border bg-card px-3 py-2 text-sm disabled:opacity-50';

export default function BulkLayoutHarness() {
  const [sessionKey, setSessionKey] = useState(0);
  const queue = useSlotOfflineQueue(scope, String(sessionKey));
  const latest = useRef(queue);
  useLayoutEffect(() => {
    latest.current = queue;
  });
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState(0);
  const [grid, setGrid] = useState('2x2');
  const [view, setView] = useState('binder');
  const [failure, setFailure] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<unknown>(null);
  const [attempted, setAttempted] = useState<unknown>(null);
  const [controlCount, setControlCount] = useState(0);
  const layoutTap = useRef<LayoutTap | null>(null);
  const [marks, setMarks] = useState<{ ids: ReadonlySet<string>; moving: boolean }>({ ids: new Set(), moving: false });
  useEffect(() => {
    let active = true;
    void (async () => {
      const adapter = latest.current;
      const record = await adapter.queue?.read();
      if (active && record && !record.snapshot)
        await adapter.saveSnapshot(await readSyntheticComplete(seed.inventory), catalog);
    })().catch(() => {
      if (active) setFailure('Synthetic initialization unavailable');
    });
    return () => {
      active = false;
    };
  }, [sessionKey]);
  useEffect(() => {
    const run = async (event: Event) => {
      const mode = (event as CustomEvent<string>).detail;
      try {
        const adapter = latest.current;
        const record = await adapter.queue?.read();
        if (!record?.snapshot) return;
        if (mode === 'scope') {
          setEditing(false);
          setSessionKey((n) => n + 1);
          return;
        }
        if (mode === 'layout' || mode === 'copy') {
          const next = structuredClone(record.snapshot);
          next.inventoryRevision++;
          next.binders[0].layoutRevision++;
          if (mode === 'layout') next.binders[0].slots.reverse();
          else {
            next.items[0].version++;
            next.binders[0].slots[0].version++;
          }
          await adapter.saveSnapshot(await readSyntheticComplete(next), catalog);
          return;
        }
        const head = record.pending[0];
        if (!head) return;
        if (head.status === 'unavailable') await adapter.queue?.resume(head.intent.request.operationId);
        const executed = projectSlotIntent(record.snapshot, head.intent, catalog);
        await adapter.replay(
          async (intent) =>
            mode === 'conflict'
              ? { status: 409, code: 'slot_revision_conflict', snapshot: await readSyntheticComplete(record.snapshot!) }
              : {
                  status: 200,
                  operationId: intent.request.operationId,
                  snapshot: await readSyntheticComplete(record.snapshot!),
                },
          catalog,
          () => readSyntheticComplete(executed),
        );
      } catch {
        setFailure('Synthetic conflict/refresh, saved group retained');
      } finally {
        setControlCount((n) => n + 1);
      }
    };
    const listener = (event: Event) => {
      void run(event);
    };
    window.addEventListener('synthetic-bulk-control', listener);
    return () => window.removeEventListener('synthetic-bulk-control', listener);
  }, []);
  const receive: SlotCommandSink = async (draft) => {
    setAttempted(draft);
    const accepted = await queue.enqueue(draft.intent, catalog);
    setReceipt(accepted);
    return accepted;
  };
  const snapshot = queue.record?.optimistic;
  const [rows, cols] = grid.split('x').map(Number);
  const slots = snapshot?.binders[0].slots ?? [];
  const pages = Math.max(1, Math.ceil(slots.length / (rows * cols)));
  const currentPage = Math.min(page, pages - 1);
  return (
    <main
      className="text-foreground mx-auto max-w-lg space-y-3 px-3"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingBottom: 'var(--dock-clearance)' }}
    >
      <h1 className="text-lg font-semibold">Synthetic bulk layout</h1>
      <p className="text-xs">Synthetic cards and partner responses. Real local durable acceptance. No hosted writes.</p>
      <div className="flex flex-wrap gap-2">
        <label>
          Grid{' '}
          <select
            aria-label="Synthetic grid"
            value={grid}
            onChange={(e) => {
              setEditing(false);
              setGrid(e.target.value);
              setPage(0);
            }}
            className={controlClass}
          >
            <option>1x1</option>
            <option>2x2</option>
            <option>2x3</option>
            <option>8x8</option>
          </select>
        </label>
        <button
          className={controlClass}
          onClick={() => {
            setView(view === 'binder' ? 'list' : 'binder');
            setEditing(false);
          }}
        >
          Change view
        </button>
      </div>
      {snapshot && view === 'binder' && (
        <>
          <nav aria-label="Synthetic pages" className="flex flex-wrap gap-2">
            <button className={controlClass} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
              Previous page
            </button>
            <span className="self-center">
              Page {currentPage + 1} of {pages}
            </span>
            <button
              className={controlClass}
              disabled={currentPage === pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              Next page
            </button>
          </nav>
          <output aria-label="Visible synthetic slots" className="block text-xs break-words">
            {slots
              .slice(currentPage * rows * cols, (currentPage + 1) * rows * cols)
              .map((s) => s.id)
              .join(', ')}
          </output>
          <LayoutToolbar
            key={`${sessionKey}:${grid}:${editing}`}
            editing={editing}
            onToggle={() => setEditing((n) => !n)}
            host={{ rows, cols }}
            onTap={(tap) => {
              layoutTap.current = tap;
            }}
            onSelection={(ids, moving) => setMarks({ ids: new Set(ids), moving })}
            boundary={{
              snapshot,
              scope: { ownerUserId: scope.ownerUserId, collectionId: snapshot.binders[0].collectionId, slotId: null },
              catalog,
              onCommandIntent: receive,
              localDurable: true,
              resolveCard: (id) => seed.cards.find((c) => c.id === id),
            }}
          />
          {/* The same pocket component as the binder: layout selection happens on the pockets themselves. */}
          <div
            aria-label="Synthetic binder page"
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {buildSlotDisplay(snapshot.binders[0], snapshot, (id) => seed.cards.find((c) => c.id === id))
              .slice(currentPage * rows * cols, (currentPage + 1) * rows * cols)
              .map((slot) => (
                <div key={slot.id} className="h-24 min-w-0">
                  <OrderedSlot
                    slot={slot}
                    selected={false}
                    onSelect={(id) => {
                      if (editing) layoutTap.current?.(id);
                    }}
                    marked={editing ? marks.ids.has(slot.id) : undefined}
                    dimmed={editing && marks.moving && marks.ids.has(slot.id)}
                    imageSizes="96px"
                    glareStyle={{}}
                    glare={false}
                  />
                </div>
              ))}
          </div>
        </>
      )}
      {!snapshot && <p role="status">Opening local synthetic binder…</p>}
      {queue.record?.pending.length ? (
        <p role="status">{queue.record.pending.length} group(s) saved on device · Pending sync</p>
      ) : null}
      {queue.record?.pending.some((p) => p.status === 'conflict') && (
        <p role="alert">Partner conflict. Whole group retained for review, no partial replay.</p>
      )}
      {(failure || queue.error) && <p role="alert">{failure ?? queue.error}</p>}
      <output aria-label="Bulk record" className="sr-only">
        {JSON.stringify(queue.record)}
      </output>
      <output aria-label="Bulk acceptance" className="sr-only">
        {JSON.stringify(receipt)}
      </output>
      <output aria-label="Bulk attempted draft" className="sr-only">
        {JSON.stringify(attempted)}
      </output>
      <output aria-label="Bulk controls" className="sr-only">
        {controlCount}
      </output>
    </main>
  );
}
