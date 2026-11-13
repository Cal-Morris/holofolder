import 'server-only';
import type { OperationContext } from '@/lib/developer-api/types';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';
import { pageMoveOrder } from '@/lib/binder-bulk-editing';
import { isStorageCommandRejection } from '@/lib/collection/storage-command-rejection';
import { StorageCommandRejectedError } from '@/lib/server/developer-access/storage-command-error';
import { readDeveloperScope } from '@/lib/server/developer-access/native-read';
import { InventoryReadError } from '@/lib/server/inventory-read-core';
import { projectNativeRead } from './native-developer-read';
import { executeDeveloperStorageOperation } from './storage-execution';
import { normalizeStorageResult } from './storage-contract';

export interface BinderPageMoveInput {
  id: string;
  from: number;
  to: number;
  operationId: string;
}

/**
 * move_binder_page: the app's "Move page N to another page" as one `move` slot command, built from the binder as it is
 * now. A retry can't rebuild the same request once the move has applied, so it replays the stored receipt instead.
 */
export async function moveBinderPage(context: OperationContext, input: BinderPageMoveInput) {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const db = createAdminClient();
  const echo = { binderId: input.id, from: input.from, to: input.to };
  let read;
  try {
    read = await readDeveloperScope(db, context, 'slots', { collectionId: input.id });
  } catch (cause) {
    if (cause instanceof InventoryReadError)
      throw new DeveloperAccessError('native_read_unavailable', 'Native reads are temporarily unavailable.', 503);
    throw cause;
  }
  // After the scoped read, so access, partner scope and billing are checked before a receipt is replayed.
  const { data: prior, error } = await db
    .from('developer_idempotency')
    .select('result')
    .eq('actor_id', context.principal.actorId)
    .eq('operation', 'binder_slots_v1')
    .eq('request_key', input.operationId)
    .maybeSingle();
  if (error) throw error;
  if (prior) {
    if (isStorageCommandRejection(prior.result, input.operationId)) throw new StorageCommandRejectedError(prior.result);
    return { ...echo, ...normalizeStorageResult('slots', prior.result) };
  }
  const data = projectNativeRead(read.snapshot!, read.owner, read.settings);
  const collection = data.collections.find((c) => c.id === input.id);
  if (!collection) throw new DeveloperAccessError('not_found', 'Binder not found.', 404);
  if (!collection.grid)
    throw new DeveloperAccessError('native_read_unavailable', 'This binder’s current layout is unknown.', 503);
  const pageSize = collection.grid.rows * collection.grid.cols;
  const pockets = data.slots
    .filter((s) => s.collectionId === input.id)
    .toSorted((a, b) => (a.position as number) - (b.position as number));
  let order;
  try {
    order = pageMoveOrder(
      pockets.map((s) => s.id),
      input.from,
      input.to,
      pageSize,
    );
  } catch {
    throw new DeveloperAccessError(
      'page_not_movable',
      `Only full pages can move, to a different full page. This binder has ${Math.floor(pockets.length / pageSize)} full pages of ${collection.grid.rows}×${collection.grid.cols}.`,
      400,
    );
  }
  const moved = new Set(order.moved);
  const request = {
    collectionId: input.id,
    operationId: input.operationId,
    inventoryRevision: data.inventoryRevision,
    collectionVersion: collection.version,
    layoutRevision: collection.layoutRevision,
    commands: [
      {
        kind: 'move',
        beforeSlotId: order.beforeSlotId,
        slots: pockets
          .filter((s) => moved.has(s.id))
          .map((s) => ({
            id: s.id,
            version: s.version,
            inventoryItemId: s.inventoryItemId,
            itemVersion: s.itemVersion,
            placementVersion: s.placementVersion,
          })),
      },
    ],
  };
  const receipt = await executeDeveloperStorageOperation(context, 'slots', request);
  if (isStorageCommandRejection(receipt, input.operationId)) throw new StorageCommandRejectedError(receipt);
  return { ...echo, ...receipt };
}
