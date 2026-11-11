import { createAdminClient } from '@/lib/supabase/admin';
import { requireDeveloperSettingsUser } from '@/lib/server/developer-access/first-party';
import { requireDeveloperEntitlement } from '@/lib/server/developer-access/entitlement';
import { DEVELOPER_HEADERS, developerErrorResponse, readDeveloperJson } from '@/lib/server/developer-access/request';
import { DeveloperAccessError, normalizePermissions } from '@/lib/developer-api/permissions';
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const { client, user } = await requireDeveloperSettingsUser(request, true);
    const body = await readDeveloperJson(request);
    if (
      typeof body.authorizationId !== 'string' ||
      body.authorizationId.length > 200 ||
      !['approve', 'deny'].includes(String(body.decision))
    )
      throw new DeveloperAccessError('invalid_authorization', 'Invalid consent decision.', 400);
    if (body.decision === 'deny') {
      const { data, error } = await client.auth.oauth.denyAuthorization(body.authorizationId, {
        skipBrowserRedirect: true,
      });
      if (error || !data)
        throw new DeveloperAccessError('invalid_authorization', 'This authorization request has expired.', 400);
      return Response.json({ redirectUrl: data.redirect_url }, { headers: DEVELOPER_HEADERS });
    }
    await requireDeveloperEntitlement(user.id);
    const permissions = normalizePermissions(body.permissions);
    const { data: details, error: detailsError } = await client.auth.oauth.getAuthorizationDetails(
      body.authorizationId,
    );
    if (detailsError || !details || !('authorization_id' in details) || details.user.id !== user.id)
      throw new DeveloperAccessError('invalid_authorization', 'Connect again to review the permissions.', 400);
    const admin = createAdminClient();
    const { data: grantId, error: grantError } = await admin.rpc('approve_developer_oauth_request', {
      authorization_id_input: body.authorizationId,
      actor: user.id,
      granted_permissions: permissions,
    });
    if (grantError || !grantId)
      throw new DeveloperAccessError(
        'invalid_authorization',
        'This request must use the Holo Folder MCP resource and PKCE. Connect again from your client.',
        400,
      );
    const { data, error } = await client.auth.oauth.approveAuthorization(body.authorizationId, {
      skipBrowserRedirect: true,
    });
    if (error || !data) {
      await admin
        .from('developer_oauth_grants')
        .update({ revoked_at: new Date().toISOString() })
        .eq('actor_id', user.id)
        .eq('id', grantId);
      throw new DeveloperAccessError(
        'authorization_failed',
        'Authorization failed. Connect again from your client.',
        400,
      );
    }
    return Response.json({ redirectUrl: data.redirect_url }, { headers: DEVELOPER_HEADERS });
  } catch (error) {
    return developerErrorResponse(error, requestId);
  }
}
