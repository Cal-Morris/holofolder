import { DeveloperAccessError, developerEntitled } from '@/lib/developer-api/permissions';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveBillingAccess } from '@/lib/billing';

/** Maps a resolve_developer_access row (alone, or inside an authenticate_* RPC result): paid entitlement, then the request budget. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function developerAccess(row: any, kind?: 'read' | 'write') {
  if (!row?.billing_access) throw new Error('Developer entitlement is temporarily unavailable');
  if (!developerEntitled(resolveBillingAccess(row.owner_user_id, row.billing_access)))
    throw new DeveloperAccessError(
      'premium_required',
      'API and MCP access require a Premium subscription or lifetime access.',
      402,
    );
  if (kind) {
    if (typeof row.budget?.allowed !== 'boolean') throw new Error('Request budget unavailable');
    if (!row.budget.allowed)
      throw new DeveloperAccessError(
        'rate_limited',
        'Request limit reached. Try again shortly.',
        429,
        Number(row.budget.retry_after) || 60,
      );
  }
  return {
    ownerUserId: row.owner_user_id as string,
    memberIds: row.member_ids as string[],
    partnershipId: row.partnership_id as string | null,
  };
}

export async function requireDeveloperEntitlement(actorId: string, kind?: 'read' | 'write') {
  const { data, error } = await createAdminClient().rpc('resolve_developer_access', {
    actor: actorId,
    request_kind: kind ?? null,
  });
  if (error) throw new Error('Developer entitlement is temporarily unavailable');
  return developerAccess(data, kind);
}
