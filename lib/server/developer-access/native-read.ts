import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OperationContext } from '@/lib/developer-api/types';
import {
  DeveloperAccessError,
  developerEntitled,
  normalizePermissions,
  requirePermissions,
  type DeveloperPermission,
} from '@/lib/developer-api/permissions';
import { resolveBillingAccess } from '@/lib/billing';

export const NATIVE_READ_PERMISSIONS = ['collection:read', 'binders:read'] as const;
const denied = (): never => {
  throw new DeveloperAccessError(
    'native_read_forbidden',
    'Current credential or collection access changed. Authenticate and read again.',
    403,
  );
};
const unavailable = (): never => {
  throw new DeveloperAccessError('native_read_unavailable', 'Native reads are temporarily unavailable.', 503);
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const sameSet = (a: readonly unknown[], b: readonly unknown[]) =>
  JSON.stringify([...new Set(a)].map(String).sort()) === JSON.stringify([...new Set(b)].map(String).sort());

export type DeveloperReadPart = 'scope' | 'collections' | 'slots' | 'items' | 'item';

/** One round trip: developer_inventory_read_v1 rechecks the credential (key, or live OAuth session and grant), the user,
 * partnership and billing, and reads the requested part in the same snapshot. The context comes from the existing
 * authenticator, never the request body or a browser session. Nothing it read is returned unless every check passes. */
export async function readDeveloperScope(
  db: SupabaseClient,
  context: OperationContext,
  part: DeveloperReadPart,
  filter: { collectionId?: string; itemId?: string } = {},
  required: readonly DeveloperPermission[] = NATIVE_READ_PERMISSIONS,
) {
  const p = context.principal;
  requirePermissions(p.permissions, required);
  if (![p.actorId, p.credentialId, context.ownerUserId, ...context.memberIds].every((id) => uuid.test(id)))
    return denied();
  if (
    p.transport === 'mcp' &&
    (!p.oauth ||
      !uuid.test(p.oauth.sessionId) ||
      !uuid.test(p.oauth.clientId) ||
      !Number.isFinite(p.oauth.expiresAt) ||
      p.oauth.expiresAt <= Date.now() / 1000)
  )
    return denied();
  if (p.transport !== 'rest' && p.transport !== 'mcp') return denied();
  const { data, error } = await db
    .rpc('developer_inventory_read_v1', {
      transport: p.transport,
      credential: p.credentialId,
      actor: p.actorId,
      oauth_session: p.oauth?.sessionId ?? null,
      oauth_client: p.oauth?.clientId ?? null,
      part,
      only_collection: filter.collectionId ?? null,
      only_item: filter.itemId ?? null,
    })
    .abortSignal(AbortSignal.timeout(15_000));
  if (error) return error.code === '42501' ? denied() : unavailable();
  if (!record(data) || !record(data.scope)) return unavailable();
  const scope = data.scope;
  const current = normalizePermissions(scope.permissions);
  requirePermissions(current, required);
  if (!sameSet(current, p.permissions)) return denied();
  if (
    !Array.isArray(scope.members) ||
    scope.owner !== context.ownerUserId ||
    !sameSet(scope.members, context.memberIds)
  )
    return denied();
  if (!record(scope.billing_access)) return unavailable();
  if (!developerEntitled(resolveBillingAccess(context.ownerUserId, scope.billing_access)))
    throw new DeveloperAccessError(
      'premium_required',
      'Native developer reads require Premium or lifetime access.',
      402,
    );
  if (part !== 'scope' && !record(data.snapshot)) return unavailable();
  return {
    owner: context.ownerUserId,
    partnership: scope.partnership ?? null,
    snapshot: data.snapshot as Record<string, unknown> | null,
    settings: record(data.settings) ? data.settings : null,
  };
}
