import type { RecoveryRejection } from './recovery-rejection';
import { parseNativeRecoveryRequest, type NativeRecoveryOperation } from '@/lib/domain/native-recovery';
import { isContractRecord, isSlotContractId, isSlotRevision } from '@/lib/domain/binder-slots';
import type { ActivityEvent } from '@/lib/collection-activity';

export interface NativeRecoveryIntent {
  operation: 'recovery.apply' | 'recovery.apply.v2';
  request: Record<string, unknown>;
  context: { source: 'app'; clientId: string; clientOccurredAt: string };
}
export interface NativeRecoveryReceipt {
  inventoryRevision: number;
  eventId: string;
  recoveredEventId: string;
}
export interface RetainedRecovery {
  intent: NativeRecoveryIntent;
  receipt: NativeRecoveryReceipt | null;
  rejection?: RecoveryRejection | null;
  resolution?: 'discarded' | null;
  synchronized: boolean;
  lease: { id: string; until: number } | null;
}
export function parseNativeRecoveryIntent(value: unknown): NativeRecoveryIntent {
  if (
    !isContractRecord(value, ['operation', 'request', 'context']) ||
    !['recovery.apply', 'recovery.apply.v2'].includes(String(value.operation)) ||
    !isContractRecord(value.context, ['source', 'clientId', 'clientOccurredAt']) ||
    value.context.source !== 'app' ||
    !isSlotContractId(value.context.clientId) ||
    typeof value.context.clientOccurredAt !== 'string' ||
    !Number.isFinite(Date.parse(value.context.clientOccurredAt))
  )
    throw new Error('invalid-recovery-intent');
  const operation = value.operation as NativeRecoveryIntent['operation'];
  return {
    operation,
    request: parseNativeRecoveryRequest(operation, value.request),
    context: { source: 'app', clientId: value.context.clientId, clientOccurredAt: value.context.clientOccurredAt },
  };
}
export function parseNativeRecoveryReceipt(value: unknown, eventId: unknown): NativeRecoveryReceipt {
  if (
    !isContractRecord(value, ['inventoryRevision', 'eventId', 'recoveredEventId', 'collections']) ||
    !isSlotRevision(value.inventoryRevision) ||
    typeof value.eventId !== 'string' ||
    !/^[1-9]\d{0,18}$/.test(value.eventId) ||
    BigInt(value.eventId) > BigInt('9223372036854775807') ||
    value.recoveredEventId !== eventId ||
    typeof eventId !== 'string'
  )
    throw new Error('invalid-recovery-receipt');
  return { inventoryRevision: value.inventoryRevision, eventId: value.eventId, recoveredEventId: eventId };
}
export function nativeRecoveryOperation(applying: boolean, version: 1 | 2): NativeRecoveryOperation {
  return `recovery.${applying ? 'apply' : 'preview'}${version === 2 ? '.v2' : ''}` as NativeRecoveryOperation;
}
/** Only the native lane can offer these events. SQL is still the final eligibility authority. */
export function isNativeRecoveryEvent(event: ActivityEvent) {
  return (
    event.format_version === 1 &&
    event.changes.length > 0 &&
    event.changes.some((c) =>
      ['inventory_items', 'inventory_placements', 'binder_slots', 'binders', 'storage_collection_state'].includes(
        c.table,
      ),
    ) &&
    /^(slots\.(create|move|clear|remove|update|bulk)|inventory\.(add|edit|setFinish|patchGrading|removeOwned|unassign|assign|move|removeSlots|deleteCollection|bulk)|collection\.create|recovery\.apply)$/.test(
      event.action,
    )
  );
}
