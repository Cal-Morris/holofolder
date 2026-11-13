import 'server-only';
import type { OperationContext } from '@/lib/developer-api/types';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';
import { describeBinderLayoutChange, planBinderLayoutChange } from '@/lib/binder-layout-change';
import { isStorageCommandRejection } from '@/lib/collection/storage-command-rejection';
import { StorageCommandRejectedError } from '@/lib/server/developer-access/storage-command-error';
import { readDeveloperScope } from '@/lib/server/developer-access/native-read';
import { InventoryReadError } from '@/lib/server/inventory-read-core';
import { projectNativeRead } from './native-developer-read';
import { executeDeveloperStorageOperation } from './storage-execution';

export interface BinderLayoutInput {
  id: string;
  rows: number;
  cols: number;
  dryRun?: boolean;
  operationId?: string;
  inventoryRevision?: number;
  collectionVersion?: number;
  layoutRevision?: number;
}

/**
 * set_binder_layout: a dry run reviews what the new grid does to the binder's cards (the same wording as the app's
 * warning) and returns the preconditions; an apply sends them back as one `layout` slot command (SQL 118), so a retry
 * with the same body replays the stored receipt and any change in between is a conflict to review again.
 */
export async function setBinderLayout(context: OperationContext, input: BinderLayoutInput) {
  const to = { rows: input.rows, cols: input.cols };
  if (!input.dryRun) {
    const operationId = input.operationId!;
    const receipt = await executeDeveloperStorageOperation(context, 'slots', {
      collectionId: input.id,
      operationId,
      inventoryRevision: input.inventoryRevision,
      collectionVersion: input.collectionVersion,
      layoutRevision: input.layoutRevision,
      commands: [{ kind: 'layout', ...to }],
    });
    if (isStorageCommandRejection(receipt, operationId)) throw new StorageCommandRejectedError(receipt);
    return { dryRun: false, binderId: input.id, layout: to, ...receipt };
  }
  const { createAdminClient } = await import('@/lib/supabase/admin');
  let data;
  try {
    const read = await readDeveloperScope(createAdminClient(), context, 'slots', { collectionId: input.id });
    data = projectNativeRead(read.snapshot!, read.owner, read.settings);
  } catch (error) {
    if (error instanceof InventoryReadError)
      throw new DeveloperAccessError('native_read_unavailable', 'Native reads are temporarily unavailable.', 503);
    throw error;
  }
  const collection = data.collections.find((c) => c.id === input.id);
  if (!collection) throw new DeveloperAccessError('not_found', 'Binder not found.', 404);
  if (!collection.grid)
    throw new DeveloperAccessError('native_read_unavailable', 'This binder’s current layout is unknown.', 503);
  const pockets = data.slots
    .filter((s) => s.collectionId === input.id)
    .toSorted((a, b) => (a.position as number) - (b.position as number));
  const {
    from,
    to: _to,
    ...consequences
  } = planBinderLayoutChange(
    pockets.map((s) => s.inventoryItemId !== null),
    collection.grid,
    to,
  );
  const plan = { from, to, ...consequences };
  return {
    dryRun: true,
    binderId: input.id,
    from,
    to,
    consequences,
    summary: describeBinderLayoutChange(plan),
    preconditions: {
      inventoryRevision: data.inventoryRevision,
      collectionVersion: collection.version,
      layoutRevision: collection.layoutRevision,
    },
  };
}
