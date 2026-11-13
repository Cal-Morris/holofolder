'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import BinderApp from '@/components/binder-app';
import { useSlotOfflineQueue } from '@/hooks/use-slot-offline-queue';
import { syntheticSlotPickerSnapshot } from '@/tests/fixtures/slot-picker';
import { readSyntheticComplete } from '@/tests/fixtures/slot-durable-session';
import { pickerCandidate } from '@/lib/slot-picker';
import { projectSlotIntent } from '@/lib/collection/slot-optimistic';
import type { SlotOfflineScope } from '@/lib/collection/slot-offline-queue';
import type { SlotCommandSink, StagedSlotCommandIntent } from '@/lib/binder-slot-editing';

// Only imported by the HOLOFOLDER_E2E=1 route. Real queue/IDB, synthetic identity/transport.
const seed = syntheticSlotPickerSnapshot();
const catalog = (id: string) => {
  const card = seed.cards.find((c) => c.id === id || c.canonicalId === id || c.aliasIds?.includes(id));
  return card ? pickerCandidate(card) : undefined;
};
const initialScope = {
  deviceId: 'synthetic-device',
  workspaceId: 'synthetic-workspace',
  accountId: 'synthetic-account',
  ownerUserId: seed.inventory.ownerUserId,
};

// oxlint-disable-next-line react-doctor/prefer-useReducer -- independent pieces of UI state; React batches the updates and one reducer would not be clearer
export default function SlotDurableSessionHarness(props: ComponentProps<typeof BinderApp>) {
  const [identity, setIdentity] = useState<{ scope: SlotOfflineScope; epoch: number }>({
    scope: initialScope,
    epoch: 0,
  });
  const sessionId = JSON.stringify(identity);
  const adapter = useSlotOfflineQueue(identity.scope, sessionId);
  const latest = useRef(adapter);
  useLayoutEffect(() => {
    latest.current = adapter;
  });
  const [draft, setDraft] = useState<StagedSlotCommandIntent | null>(null);
  const [receipt, setReceipt] = useState<unknown>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [controls, setControls] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const generation = useRef(sessionId);
  useLayoutEffect(() => {
    generation.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const current = latest.current;
      const record = await current.queue?.read();
      if (!active || !record || record.snapshot) return;
      const snapshot = structuredClone(seed.inventory),
        owner = identity.scope.ownerUserId ?? identity.scope.workspaceId;
      snapshot.ownerUserId = owner;
      snapshot.items.forEach((i) => {
        i.ownerUserId = owner;
      });
      snapshot.collections.forEach((c) => {
        c.ownerUserId = owner;
      });
      snapshot.binders.forEach((b) => {
        b.ownerUserId = owner;
        b.slots.forEach((s) => {
          s.ownerUserId = owner;
        });
      });
      await current.saveSnapshot(await readSyntheticComplete(snapshot), catalog);
    })().catch(() => {
      if (active) setFailure('Synthetic initialization failed');
    });
    return () => {
      active = false;
    };
  }, [sessionId, identity.scope.ownerUserId, identity.scope.workspaceId]);

  useEffect(() => {
    const control = async (event: Event) => {
      const mode = (event as CustomEvent<string>).detail;
      const current = latest.current;
      const token = generation.current;
      try {
        if (mode === 'refresh') {
          await current.refresh();
          return;
        }
        if (mode === 'signout' || mode === 'signin') {
          setIdentity((previous) => ({
            epoch: previous.epoch + 1,
            scope: mode === 'signin' ? initialScope : { ...initialScope, accountId: null, ownerUserId: null },
          }));
          setDraft(null);
          setReceipt(null);
          return;
        }
        if (mode === 'relink' || mode === 'account' || mode === 'owner') {
          setIdentity((previous) => ({
            epoch: previous.epoch + 1,
            scope: {
              ...previous.scope,
              ...(mode === 'account' ? { accountId: `${previous.scope.accountId}-other` } : {}),
              ...(mode === 'owner' ? { ownerUserId: `${previous.scope.ownerUserId}-other` } : {}),
            },
          }));
          setDraft(null);
          setReceipt(null);
          return;
        }
        const record = await current.queue?.read(),
          head = record?.pending[0];
        if (!record?.snapshot || !head || !current.queue) return;
        if (head.status !== 'pending') await current.queue.resume(head.intent.request.operationId);
        // No parallel mock inventory store: use the real queue's retained base and exact intent.
        const executed = projectSlotIntent(record.snapshot, head.intent, catalog);
        await current.replay(
          async (intent) => {
            await current.refresh();
            setSent((previous) => [...previous, intent.request.operationId]);
            if (mode === 'lost') throw new Error('synthetic-interrupted-response');
            if (mode === '503') return { status: 503 };
            if (mode === '409')
              return {
                status: 409,
                code: 'slot_revision_conflict',
                snapshot: await readSyntheticComplete(record.snapshot!),
              };
            if (mode === 'deferred')
              await new Promise<void>((resolve) =>
                window.addEventListener('synthetic-durable-release', () => resolve(), { once: true }),
              );
            return {
              status: 200,
              operationId: mode === 'invalid' ? 'wrong-operation' : intent.request.operationId,
              snapshot: await readSyntheticComplete(record.snapshot!),
            }; // deliberately historical ledger payload
          },
          catalog,
          async () => {
            if (generation.current !== token) throw new Error('synthetic-session-ended');
            return readSyntheticComplete(mode === 'stale' ? record.snapshot! : executed, mode === 'partial');
          },
        );
      } catch {
        setFailure('Synthetic replay/refresh unavailable, intent retained');
      } finally {
        setControls((previous) => previous + 1);
      }
    };
    const listener = (event: Event) => {
      void control(event);
    };
    window.addEventListener('synthetic-durable-control', listener);
    return () => window.removeEventListener('synthetic-durable-control', listener);
  }, []);

  const receive: SlotCommandSink = async (incoming) => {
    const token = sessionId;
    if (!identity.scope.accountId || incoming.scope.ownerUserId !== identity.scope.ownerUserId)
      throw new Error('session-scope-changed');
    setDraft(incoming);
    const result = await adapter.enqueue(incoming.intent, catalog);
    if (generation.current === token) setReceipt(result);
    return result;
  };
  const snapshot = adapter.record?.optimistic;
  return (
    <>
      <output aria-label="Durable controls" className="sr-only">
        {controls}
      </output>
      <output aria-label="Durable record" className="sr-only">
        {JSON.stringify(adapter.record)}
      </output>
      <output aria-label="Durable draft" className="sr-only">
        {JSON.stringify(draft)}
      </output>
      <output aria-label="Durable acceptance" className="sr-only">
        {JSON.stringify(receipt)}
      </output>
      <output aria-label="Durable sent IDs" className="sr-only">
        {JSON.stringify(sent)}
      </output>
      <output aria-label="Durable session" className="sr-only">
        {sessionId}
      </output>
      {adapter.record && adapter.record.pending.length > 0 && <p role="status">Saved on device · Pending sync</p>}
      {adapter.record?.pending.some((p) => ['conflict', 'blocked', 'billing'].includes(p.status)) && (
        <p role="alert">
          Pending sync needs attention. Original intent is saved on this device. Reconcile before adding edits.
        </p>
      )}
      {adapter.record?.pending.some((p) => p.status === 'unavailable') && (
        <p role="status">Sync is unavailable. Saved intent remains on this device.</p>
      )}
      {(adapter.error || failure) && <p role="alert">{adapter.error ?? failure}</p>}
      {adapter.error && (
        <button
          type="button"
          className="min-h-10 rounded-xl border px-3 text-sm"
          onClick={() => {
            void adapter.refresh().catch(() => setFailure('Refresh unavailable, saved intent retained'));
          }}
        >
          Retry refresh
        </button>
      )}
      {snapshot ? (
        <BinderApp
          {...props}
          key={sessionId}
          stagedSlotSessionId={sessionId}
          stagedSlotLocalDurable
          initialUser={identity.scope.accountId ? props.initialUser : null}
          stagedSlotDisplay={{ ...seed, inventory: snapshot, binder: snapshot.binders[0] }}
          stagedSlotCatalog={catalog}
          onStagedSlotCommandIntent={
            !identity.scope.accountId || props.readOnlyMode || props.shareViewToken ? undefined : receive
          }
        />
      ) : (
        <p role="status">Opening synthetic durable session…</p>
      )}
    </>
  );
}
