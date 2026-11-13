// What the binder says about the offline queue's first waiting change, and the Discard action for a change the server
// refused (components/collection-navigation/browser-session.tsx). Pure, no React. The queue's own record
// (lib/collection/slot-offline-queue.ts) stays as stored; this only names the states its fields add up to.
import { blockedDiscardable, type PendingSlotIntent } from '@/lib/collection/slot-offline-queue';

export type QueueHeadNotice =
  | { kind: 'none' }
  /** A change is saved on the device and waits for a connection. */
  | { kind: 'offline' }
  /** The last send didn't get an answer; it is retried by itself. */
  | { kind: 'retrying' }
  /** The collection changed elsewhere, so the change waits for a retry. */
  | { kind: 'on-hold' }
  | { kind: 'billing' }
  /** The server refused it outright (a 4xx other than sign-in): only Discard clears it, with the `later` changes queued on it. */
  | { kind: 'refused'; operationId: string; later: number }
  /** Blocked for another reason, usually signing in: Try again after fixing it. */
  | { kind: 'paused' };

type Held = Pick<PendingSlotIntent, 'status' | 'conflict' | 'intent'>;
const held = (p: Held) => p.status === 'conflict' || p.status === 'blocked' || p.status === 'billing';

/**
 * Only one notice shows. A change that is on its way, or accepted and waiting for a read to cover it, needs no line;
 * one waiting on something says what. Changes a decision is needed for (`conflict.rejected`) have their own panels.
 */
export function queueHeadNotice(pending: readonly Held[] | undefined, online: boolean): QueueHeadNotice {
  const head = pending?.[0];
  const waiting = pending?.find((p) => p.status !== 'acknowledged');
  if (waiting && !waiting.conflict?.rejected && !held(waiting)) {
    if (!online) return { kind: 'offline' };
    return waiting.status === 'unavailable' ? { kind: 'retrying' } : { kind: 'none' };
  }
  if (!head || !held(head) || head.conflict?.rejected) return { kind: 'none' };
  if (head.status === 'conflict') return { kind: 'on-hold' };
  if (head.status === 'billing') return { kind: 'billing' };
  return blockedDiscardable(head)
    ? { kind: 'refused', operationId: head.intent.request.operationId, later: pending!.length - 1 }
    : { kind: 'paused' };
}

/**
 * Discarding a refused change: one at a time. While it runs, Discard and Try again are off, so a double tap can't run
 * a second discard (which would fail and replace the first one's notice), and a retry can't flip the change back to
 * pending under it.
 */
export type QueueDiscard = { kind: 'idle' } | { kind: 'discarding'; operationId: string };
export type QueueDiscardEvent = { type: 'discard'; operationId: string } | { type: 'settled' };
export const IDLE_QUEUE_DISCARD: QueueDiscard = { kind: 'idle' };

export function queueDiscardTransition(state: QueueDiscard, event: QueueDiscardEvent): QueueDiscard {
  if (event.type === 'discard')
    return state.kind === 'idle' ? { kind: 'discarding', operationId: event.operationId } : state;
  return state.kind === 'discarding' ? IDLE_QUEUE_DISCARD : state;
}
