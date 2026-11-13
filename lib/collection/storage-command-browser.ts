import { readRawRestoreDelivery } from '@/lib/collection/raw-restore-delivery';
import { isCreationRejection } from '@/lib/collection/creation-import-rejection';
import { isStorageCommandRejection } from '@/lib/collection/storage-command-rejection';
import { appPath } from '@/lib/app-path';
import { trackCollectionCommand } from '@/lib/google-analytics';
import { parseSlotIntent, type SlotOfflineIntent } from '@/lib/collection/slot-optimistic';
import { sameInventoryReadScope, type InventoryReadScope } from '@/lib/collection/inventory-read-transport';
import type { SlotReplayResult } from '@/lib/collection/slot-offline-queue';
import { isContractRecord, isSlotRevision, isSlotContractId } from '@/lib/domain/binder-slots';

/** Exact request replay. Queued provenance stays local; authenticated server context is authoritative.
 * A receipt is never a complete snapshot. The queue must start its own fresh read after this returns. */
export async function sendStorageCommand(
  intent: SlotOfflineIntent,
  currentScope: () => InventoryReadScope | null,
  signal: AbortSignal,
  localHarness = false,
): Promise<SlotReplayResult> {
  const current = currentScope();
  if (!current || signal.aborted) return { status: 0 };
  const scope = { ...current },
    parsed = parseSlotIntent(intent),
    deliveryId = crypto.randomUUID();
  if (
    parsed.kind === 'raw-restore' &&
    (parsed.request.planning.actorUserId !== scope.actorUserId ||
      parsed.request.planning.ownerUserId !== scope.ownerUserId ||
      parsed.request.planning.authSessionId !== scope.authSessionId)
  )
    return { status: 0 };
  const valid = () => !signal.aborted && sameInventoryReadScope(currentScope(), scope);
  try {
    const path = localHarness
      ? `/e2e-harness/storage/${parsed.kind}`
      : parsed.kind === 'raw-restore'
        ? '/api/raw-content-restore'
        : parsed.kind === 'creation'
          ? '/api/storage-collections'
          : parsed.kind === 'slots'
            ? '/api/binder-slots'
            : '/api/inventory';
    const response = await fetch(appPath(path), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Binder-Owner': scope.ownerUserId,
        'X-Binder-Auth-Session': scope.authSessionId,
        'X-Binder-Actor': scope.actorUserId,
        'X-Storage-Delivery': deliveryId,
        'X-Storage-Operation': parsed.request.operationId,
      },
      body: JSON.stringify(parsed.request),
    });
    if (!valid() || response.redirected) return { status: 0 };
    // oxlint-disable-next-line react-doctor/async-defer-await -- validity is rechecked after every await
    const body: unknown = await response.json();
    if (!valid()) return { status: 0 };
    if (parsed.kind === 'raw-restore') {
      // oxlint-disable-next-line react-doctor/async-defer-await -- validity is rechecked after every await
      const rawRestoreProof = await readRawRestoreDelivery(response, body, parsed.request, scope, deliveryId);
      if (!valid()) return { status: 0 };
      return rawRestoreProof
        ? {
            status: rawRestoreProof.receipt ? 200 : 409,
            operationId: parsed.request.operationId,
            inventoryRevision: (rawRestoreProof.receipt ?? rawRestoreProof.rejection)!.inventoryRevision,
            rawRestoreProof,
          }
        : { status: response.status === 200 ? 0 : response.status };
    }
    const privateReply = response.headers.get('cache-control')?.split(/\s*,\s*/);
    if (
      parsed.kind === 'creation' &&
      response.status === 409 &&
      privateReply?.includes('private') &&
      privateReply.includes('no-store') &&
      response.headers.get('content-type')?.startsWith('application/json') &&
      response.headers.get('X-Storage-Delivery') === deliveryId &&
      response.headers.get('X-Storage-Family') === 'collection.create' &&
      response.headers.get('X-Storage-Operation') === parsed.request.operationId &&
      isContractRecord(body, ['error']) &&
      Object.keys(body).length === 1 &&
      isContractRecord(body.error, ['code', 'message', 'requestId', 'rejection']) &&
      Object.keys(body.error).length === 4 &&
      body.error.code === 'storage_creation_rejected' &&
      typeof body.error.message === 'string' &&
      isSlotContractId(body.error.requestId) &&
      body.error.requestId === response.headers.get('X-Request-Id') &&
      isCreationRejection(body.error.rejection, parsed.request.operationId)
    ) {
      return {
        status: 409,
        operationId: parsed.request.operationId,
        creationProof: {
          family: 'collection.create',
          deliveryId,
          scope: { accountId: scope.actorUserId, ownerUserId: scope.ownerUserId, authSessionId: scope.authSessionId },
          intent: parsed,
          rejection: body.error.rejection,
        },
      };
    }
    if (
      parsed.kind !== 'creation' &&
      response.status === 409 &&
      privateReply?.includes('private') &&
      privateReply.includes('no-store') &&
      response.headers.get('content-type')?.startsWith('application/json') &&
      isContractRecord(body, ['version', 'operationId', 'rejection']) &&
      Object.keys(body).length === 3 &&
      body.version === 1 &&
      body.operationId === parsed.request.operationId &&
      isStorageCommandRejection(body.rejection, parsed.request.operationId)
    ) {
      return {
        status: 409,
        code: body.rejection.code,
        operationId: parsed.request.operationId,
        rejection: body.rejection,
      };
    }
    if (response.status !== 200) {
      const code =
        isContractRecord(body, ['error']) &&
        isContractRecord(body.error, ['code', 'message', 'requestId']) &&
        typeof body.error.code === 'string'
          ? body.error.code
          : undefined;
      return { status: response.status, code };
    }
    const cache = response.headers.get('cache-control')?.split(/\s*,\s*/);
    if (
      !cache?.includes('private') ||
      !cache.includes('no-store') ||
      !response.headers.get('content-type')?.startsWith('application/json') ||
      !isContractRecord(body, ['version', 'operationId', 'receipt']) ||
      body.version !== 1 ||
      body.operationId !== parsed.request.operationId ||
      !validReceipt(body.receipt, parsed)
    )
      return { status: 0 };
    if (!localHarness) trackCollectionCommand(parsed);
    return {
      status: 200,
      operationId: parsed.request.operationId,
      inventoryRevision: (body.receipt as { inventoryRevision: number }).inventoryRevision,
    };
  } catch {
    return { status: 0 };
  }
}
function validReceipt(value: unknown, intent: SlotOfflineIntent) {
  if (intent.kind === 'raw-restore') return false;
  const kind = intent.kind;
  if (kind === 'creation') {
    const fields = [
      'inventoryRevision',
      'collectionId',
      'collectionVersion',
      'layoutRevision',
      'changed',
      'slotIds',
      'recoverySupported',
    ];
    return (
      isContractRecord(value, fields) &&
      Object.keys(value).length === fields.length &&
      isSlotRevision(value.inventoryRevision) &&
      isSlotRevision(value.collectionVersion) &&
      isSlotRevision(value.layoutRevision) &&
      value.collectionId === intent.request.collectionId &&
      value.changed === true &&
      value.recoverySupported === false &&
      JSON.stringify(value.slotIds) === JSON.stringify(intent.request.slotIds)
    );
  }
  const fields =
    kind === 'slots'
      ? ['inventoryRevision', 'changed', 'collectionVersion', 'layoutRevision', 'removedSlotIds']
      : ['inventoryRevision', 'changed', 'selectedItemIds', 'acquiredItemIds'];
  if (
    !isContractRecord(value, fields) ||
    Object.keys(value).length !== fields.length ||
    !isSlotRevision(value.inventoryRevision) ||
    typeof value.changed !== 'boolean'
  )
    return false;
  const list = (v: unknown) => Array.isArray(v) && v.length <= 16384 && v.every(isSlotContractId);
  return kind === 'slots'
    ? isSlotRevision(value.collectionVersion) && isSlotRevision(value.layoutRevision) && list(value.removedSlotIds)
    : list(value.selectedItemIds) && list(value.acquiredItemIds);
}
