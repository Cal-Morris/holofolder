'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { SlotCommandSink, SlotLocalAcceptance, StagedSlotCommandIntent } from '@/lib/binder-slot-editing';
import type { InventoryCatalogResolver } from '@/lib/domain/inventory';
import type { InventoryCatalogEvidence } from '@/lib/domain/inventory-browse';
import { slotDraftFailureMessage } from '@/lib/slot-draft-failure';

/** The pending draft (and the evidence it was prepared with) is immutable until accepted or this selection is dismissed. */
export function useSlotDraftAcceptance<T extends StagedSlotCommandIntent>(sink: SlotCommandSink, accepted: () => void) {
  const [pending, setPending] = useState<{
    draft: T;
    selected?: InventoryCatalogResolver;
    picked?: InventoryCatalogEvidence;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const handoff = (draft: T, selected?: InventoryCatalogResolver, picked?: InventoryCatalogEvidence) => {
    if (lock.current) return;
    lock.current = true;
    setPending({ draft, selected, picked });
    setBusy(true);
    setMessage(null);
    const finish = (receipt: SlotLocalAcceptance | void) => {
      if (receipt && (receipt.status !== 'saved-on-device' || receipt.operationId !== draft.intent.request.operationId))
        throw new Error('invalid-local-acceptance');
      if (!mounted.current) return;
      setPending(null);
      setBusy(false);
      lock.current = false;
      accepted();
      // Local acceptance is not a server save, so no success line is kept here: the session reports what is still
      // waiting to sync from the queue itself, and clears it on acknowledgement.
      setMessage(receipt?.refreshError ?? null);
    };
    const failed = (cause: unknown) => {
      if (!mounted.current) return;
      lock.current = false;
      setBusy(false);
      setMessage(slotDraftFailureMessage(cause));
    };
    try {
      const result = sink(draft, selected, picked);
      if (result) void result.then(finish).catch(failed);
      else finish();
    } catch (cause) {
      failed(cause);
    }
  };
  const retry = () => {
    if (pending) handoff(pending.draft, pending.selected, pending.picked);
  };
  /** Drops a draft that failed locally; never while a handoff is in flight. */
  const discard = () => {
    if (lock.current) return;
    setPending(null);
    setMessage(null);
  };
  return { pending: pending?.draft ?? null, busy, message, handoff, retry, discard };
}
