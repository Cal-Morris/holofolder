import { parseInventoryCommand } from '@/lib/domain/inventory-commands';
import type { InventoryCommandRequest } from '@/lib/domain/inventory-commands';
import { normalizeAuditContext } from '@/lib/domain/audit-context';
import type { AuditContext } from '@/lib/domain/audit-context';
export { parseInventoryCommand } from '@/lib/domain/inventory-commands';
export type { InventoryCommandRequest } from '@/lib/domain/inventory-commands';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function invalid(): never {
  throw new Error('Invalid or oversized inventory command');
}

/** Internal adapter only. A future authenticated boundary establishes context and binds the RPC. */
export async function executeInventoryCommand(
  rpc: (
    actor: string,
    owner: string,
    request: InventoryCommandRequest,
    intent: Pick<AuditContext, 'source' | 'clientId' | 'batchId' | 'clientOccurredAt'>,
  ) => Promise<unknown>,
  owner: string,
  request: InventoryCommandRequest,
  context: AuditContext,
): Promise<unknown> {
  const parsed = parseInventoryCommand(request),
    trusted = normalizeAuditContext(context);
  if (
    !uuid(owner) ||
    !trusted ||
    trusted.actor.kind !== 'user' ||
    !uuid(trusted.actor.userId) ||
    trusted.operationId !== parsed.operationId
  )
    return invalid();
  return rpc(trusted.actor.userId, owner, parsed, {
    source: trusted.source,
    clientId: trusted.clientId,
    batchId: trusted.batchId,
    clientOccurredAt: trusted.clientOccurredAt,
  });
}
