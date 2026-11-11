import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { decodePage, encodeCursor } from '@/lib/developer-api/pagination';
import { managementDatabaseError } from './management';
export async function readDeveloperPartners(actor: User, params: URLSearchParams) {
  const admin = createAdminClient(),
    page = decodePage(params);
  let invites = admin
    .from('partner_invites')
    .select('id,inviter_id,inviter_email,invitee_email,status,created_at')
    .or(`inviter_id.eq.${actor.id},invitee_email.eq.${JSON.stringify(actor.email ?? '')}`)
    .order('id')
    .limit(page.limit + 1);
  if (page.after) invites = invites.gt('id', page.after);
  const [membership, result] = await Promise.all([
    admin
      .from('partnerships')
      .select('id,owner_user_id,user1_id,user2_id,created_at')
      .or(`user1_id.eq.${actor.id},user2_id.eq.${actor.id}`)
      .limit(1)
      .maybeSingle(),
    invites,
  ]);
  managementDatabaseError(membership.error);
  managementDatabaseError(result.error);
  const rows = result.data ?? [];
  return {
    partnership: membership.data,
    invites: rows.slice(0, page.limit),
    nextCursor: rows.length > page.limit ? encodeCursor(rows[page.limit - 1].id, params) : null,
  };
}
export async function changeDeveloperPartner(
  actorId: string,
  action: 'invite' | 'accept' | 'reject' | 'disconnect',
  input: Record<string, unknown>,
) {
  const { data, error } = await createAdminClient().rpc('developer_partner_action', {
    actor: actorId,
    action,
    email: input.email ?? null,
    invite_id: input.inviteId ?? null,
  });
  managementDatabaseError(error);
  return data;
}
