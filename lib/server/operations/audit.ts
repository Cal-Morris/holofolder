import type { OperationContext } from '@/lib/developer-api/types';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';
import { decodePage, encodeCursor } from '@/lib/developer-api/pagination';
import { createAdminClient } from '@/lib/supabase/admin';
import { projectActivityChanges } from '@/lib/collection-activity';

// changes holds whole rows; every row is projected to the shown fields before it leaves the server,
// so certificates, labels and artwork uploads never do.
export const AUDIT_READ_COLUMNS =
  'id::text,recorded_at,format_version,actor_kind,actor_user_id,actor_job,source,client_id,operation_id,batch_id,client_occurred_at,action,affected_entities,changes,recovery_of_event_id::text';
export function isAuditId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= BigInt('9223372036854775807');
}
export async function readCollectionAudit(
  context: Pick<OperationContext, 'ownerUserId'>,
  input: Record<string, unknown>,
  detail = false,
  client = createAdminClient(),
) {
  const params = new URLSearchParams(
    Object.entries(input)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
  const page = detail ? { limit: 1, after: null } : decodePage(params);
  if ((detail && !isAuditId(input.id)) || (page.after && !isAuditId(page.after)))
    throw new DeveloperAccessError('invalid_pagination', 'Use the cursor from this audit query.', 400);
  let query = client
    .from('collection_activity')
    .select(AUDIT_READ_COLUMNS)
    .eq('owner_user_id', context.ownerUserId)
    .order('id', { ascending: false })
    .limit(page.limit + 1);
  if (detail) query = query.eq('id', String(input.id));
  if (page.after) query = query.lt('id', page.after);
  if (input.collectionId) query = query.contains('affected_entities', { collectionIds: [input.collectionId] });
  if (input.inventoryItemId) query = query.contains('affected_entities', { inventoryItemIds: [input.inventoryItemId] });
  if (input.slotId) query = query.contains('affected_entities', { slotIds: [input.slotId] });
  // JSON containment reaches retained deltas, including deleted entities and bulk events.
  // Quote JSON operands for PostgREST's logic grammar, never interpolate untrusted syntax.
  const operand = (value: unknown) => JSON.stringify(JSON.stringify(value));
  const retained = (field: string, value: unknown) =>
    ['before', 'after'].map((side) => `changes.cs.${operand([{ [side]: { [field]: value } }])}`);
  const groups: string[] = [];
  const identity = (key: string, value: unknown) =>
    ['before', 'after'].flatMap((side) =>
      ['identity', 'target'].map((field) => `changes.cs.${operand([{ [side]: { [field]: { [key]: value } } }])}`),
    );
  if (input.pokemonId) groups.push(identity('pokemonId', Number(input.pokemonId)).join(','));
  if (input.cardId)
    groups.push(
      [...retained('wanted_cards', [{ card_id: input.cardId }]), ...identity('cardId', input.cardId)].join(','),
    );
  if (groups.length) query = query.or(`and(${groups.map((group) => `or(${group})`).join(',')})`);
  if (input.actorId) query = query.eq('actor_user_id', String(input.actorId));
  if (input.operationId) query = query.eq('operation_id', String(input.operationId));
  if (input.action) query = query.eq('action', String(input.action));
  if (input.recoveryOfEventId) query = query.eq('recovery_of_event_id', String(input.recoveryOfEventId));
  if (input.since) query = query.gte('recorded_at', String(input.since));
  if (input.until) query = query.lte('recorded_at', String(input.until));
  const { data, error } = await query;
  if (error) throw new DeveloperAccessError('audit_unavailable', 'Collection history is temporarily unavailable.', 503);
  const rows = (data ?? []).map((row) => ({ ...row, changes: projectActivityChanges(row.changes) }));
  if (detail) {
    if (!rows[0]) throw new DeveloperAccessError('not_found', 'History entry not found.', 404);
    return rows[0];
  }
  return {
    data: rows.slice(0, page.limit),
    nextCursor: rows.length > page.limit ? encodeCursor(String(rows[page.limit - 1].id), params) : null,
  };
}
