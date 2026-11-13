import { getFirstPartyUser } from '@/lib/supabase/session-user';
import { createClient } from '@/lib/supabase/server';
import { startPendingPartnerPush } from '@/lib/server/partner-push';

const headers = { 'cache-control': 'private, no-store' };

export async function POST() {
  const {
    data: { user },
  } = await getFirstPartyUser(await createClient());
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401, headers });
  try {
    return Response.json({ started: await startPendingPartnerPush(user.id) }, { headers });
  } catch {
    return Response.json({ error: 'Partner updates will retry when you reconnect.' }, { status: 503, headers });
  }
}
