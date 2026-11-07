import { createClient } from '@/lib/supabase/server'
import { startPendingPartnerPush } from '@/lib/server/partner-push'

export async function POST() {
  const headers = { 'cache-control': 'private, no-store' }
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401, headers })
  try {
    return Response.json({ started: await startPendingPartnerPush(user.id) }, { headers })
  } catch {
    return Response.json({ error: 'Partner updates will retry when you reconnect.' }, { status: 503, headers })
  }
}
