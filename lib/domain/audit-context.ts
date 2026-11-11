import { isContractRecord, isSlotContractId } from '@/lib/domain/binder-slots';

/** Queue-safe original intent. No actor, credentials or arbitrary request metadata. */
export interface OperationIntentContext {
  source: 'app' | 'rest' | 'mcp' | 'import' | 'system' | 'migration';
  clientId: string | null;
  operationId: string;
  batchId: string | null;
  clientOccurredAt: string | null;
}

/** Only the authenticated server boundary may establish actor/source/client attribution.
 * A structurally valid value or a pure preview is never evidence of authentication. */
export interface AuditContext extends OperationIntentContext {
  actor: { kind: 'user'; userId: string } | { kind: 'system'; job: string } | { kind: 'unknown' };
  affectedEntities: { inventoryItemIds: string[]; slotIds: string[]; collectionIds: string[] };
}

/** Shape validation only. Never accept this actor from HTTP, imports or an offline queue. */
export function normalizeAuditContext(value: unknown): AuditContext | undefined {
  if (
    !isContractRecord(value, [
      'actor',
      'source',
      'clientId',
      'operationId',
      'batchId',
      'clientOccurredAt',
      'affectedEntities',
    ]) ||
    !['app', 'rest', 'mcp', 'import', 'system', 'migration'].includes(value.source as string) ||
    !isSlotContractId(value.operationId) ||
    (value.clientId !== null && !isSlotContractId(value.clientId)) ||
    (value.batchId !== null && !isSlotContractId(value.batchId)) ||
    (value.clientOccurredAt !== null &&
      (typeof value.clientOccurredAt !== 'string' || !Number.isFinite(Date.parse(value.clientOccurredAt))))
  )
    return undefined;
  const actor = value.actor,
    affected = value.affectedEntities;
  if (
    !isContractRecord(actor, ['kind', 'userId', 'job']) ||
    !isContractRecord(affected, ['inventoryItemIds', 'slotIds', 'collectionIds'])
  )
    return undefined;
  let actorValue: AuditContext['actor'];
  if (actor.kind === 'user' && isSlotContractId(actor.userId) && !('job' in actor))
    actorValue = { kind: 'user', userId: actor.userId };
  else if (actor.kind === 'system' && isSlotContractId(actor.job) && !('userId' in actor))
    actorValue = { kind: 'system', job: actor.job };
  else if (actor.kind === 'unknown' && Object.keys(actor).length === 1) actorValue = { kind: 'unknown' };
  else return undefined;
  const ids = (v: unknown): v is string[] => Array.isArray(v) && Array.from(v).every(isSlotContractId);
  if (!ids(affected.inventoryItemIds) || !ids(affected.slotIds) || !ids(affected.collectionIds)) return undefined;
  return {
    actor: actorValue,
    source: value.source as AuditContext['source'],
    clientId: value.clientId as string | null,
    operationId: value.operationId,
    batchId: value.batchId as string | null,
    clientOccurredAt: value.clientOccurredAt,
    affectedEntities: {
      inventoryItemIds: [...affected.inventoryItemIds],
      slotIds: [...affected.slotIds],
      collectionIds: [...affected.collectionIds],
    },
  };
}
