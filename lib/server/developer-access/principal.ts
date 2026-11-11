import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDeveloperKey } from './key-secret';
import {
  DeveloperAccessError,
  normalizePermissions,
  requirePermissions,
  type DeveloperPermission,
} from '@/lib/developer-api/permissions';
import { validateMcpOrigin } from '@/lib/developer-api/oauth';
import type { OperationContext } from '@/lib/developer-api/types';
import type { McpIdentity } from './grants';
import { developerAccess } from './entitlement';
import { developerPreauthBucket } from './limits';
import { bearerCredential } from './request';
export async function requireRestContext(
  request: Request,
  required: readonly DeveloperPermission[],
  kind: 'read' | 'write',
  requestId: string = crypto.randomUUID(),
): Promise<OperationContext> {
  const raw = bearerCredential(request);
  if (!raw)
    throw new DeveloperAccessError(
      'invalid_api_key',
      'Authenticate with an API key in the Authorization bearer header.',
      401,
    );
  const parsed = parseDeveloperKey(raw);
  if (!parsed) throw new DeveloperAccessError('invalid_api_key', 'Provide a valid, unexpired API key.', 401);
  const { data, error } = await createAdminClient().rpc('authenticate_developer_request', {
    key_id: parsed.id,
    presented_digest: createHash('sha256').update(parsed.secret).digest('hex'),
    required_permissions: [...required],
    request_kind: kind,
    preauth_bucket: developerPreauthBucket(request),
  });
  if (error || !data) throw new Error('Developer authorization unavailable');
  if (data.error === 'rate_limited')
    throw new DeveloperAccessError(
      'rate_limited',
      'Request limit reached. Try again shortly.',
      429,
      Number(data.retry_after) || 60,
    );
  if (data.error === 'invalid_api_key')
    throw new DeveloperAccessError('invalid_api_key', 'Provide a valid, unexpired API key.', 401);
  if (data.error === 'insufficient_permissions')
    throw new DeveloperAccessError(
      'insufficient_permissions',
      'This credential does not have permission for this operation.',
      403,
    );
  if (data.error) throw new Error('Developer authorization unavailable');
  const access = developerAccess(data, kind);
  const principal = {
    actorId: data.actor_id,
    credentialId: data.credential_id,
    transport: 'rest' as const,
    permissions: normalizePermissions(data.permissions),
  };
  requirePermissions(principal.permissions, required);
  return { principal, ownerUserId: access.ownerUserId, memberIds: access.memberIds, requestId };
}

/** One round trip per MCP HTTP request: IP budget, live grant and session, partnership, billing and request budget.
 * The identity comes from verifyMcpToken; tools check their own permissions against the returned grant. */
export async function requireMcpContext(
  identity: McpIdentity,
  request: Request,
  kind: 'read' | 'write',
  requestId: string = crypto.randomUUID(),
): Promise<OperationContext> {
  const { data, error } = await createAdminClient().rpc('authenticate_developer_oauth_request', {
    session: identity.sessionId,
    actor: identity.actorId,
    client: identity.clientId,
    grant_version: identity.grantId,
    request_kind: kind,
    preauth_bucket: developerPreauthBucket(request),
  });
  if (error || !data) throw new Error('OAuth grant lookup unavailable');
  if (data.error === 'rate_limited')
    throw new DeveloperAccessError(
      'rate_limited',
      'Request limit reached. Try again shortly.',
      429,
      Number(data.retry_after) || 60,
    );
  if (data.error === 'oauth_revoked')
    throw new DeveloperAccessError(
      'oauth_revoked',
      'This MCP connection has expired or been revoked. Connect again.',
      401,
    );
  if (data.error) throw new Error('OAuth grant lookup unavailable');
  validateMcpOrigin(request.headers.get('origin'), data.redirect_origin);
  const access = developerAccess(data, kind);
  const principal = {
    actorId: identity.actorId,
    credentialId: data.credential_id,
    transport: 'mcp' as const,
    oauth: { sessionId: identity.sessionId, clientId: identity.clientId, expiresAt: identity.expiresAt },
    permissions: normalizePermissions(data.permissions),
  };
  return { principal, ownerUserId: access.ownerUserId, memberIds: access.memberIds, requestId };
}
