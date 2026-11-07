import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/session-user'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { 'cache-control': 'private, no-store' }
  const user = await getSessionUser(await createClient())
  const { id } = await context.params
  if (!user) return Response.json({}, { status: 401, headers })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({}, { status: 400, headers })
  const admin = createAdminClient()
  const { data: event, error } = await admin.from('partner_acquisitions').select('recipient_id,actor_id,owner_user_id,partnership_id,binder_id,card_name,actor_name').eq('id', id).eq('recipient_id', user.id).maybeSingle()
  if (error) return Response.json({}, { status: 503, headers })
  if (!event) return Response.json({}, { status: 404, headers })
  const { data: partnership, error: membershipError } = await admin.from('partnerships').select('user1_id,user2_id').eq('id', event.partnership_id).eq('owner_user_id', event.owner_user_id).maybeSingle()
  if (membershipError) return Response.json({}, { status: 503, headers })
  if (!partnership || ![partnership.user1_id, partnership.user2_id].includes(user.id) || ![partnership.user1_id, partnership.user2_id].includes(event.actor_id)) return Response.json({}, { status: 404, headers })
  const { data: binder, error: binderError } = await admin.from('binders').select('name').eq('id', event.binder_id).eq('owner_user_id', event.owner_user_id).maybeSingle()
  if (binderError) return Response.json({}, { status: 503, headers })
  if (!binder) return Response.json({}, { status: 404, headers })
  return Response.json({ title: `${event.actor_name} found a card`, body: `${event.card_name} was added to ${binder.name}.`, url: `/?binder=${encodeURIComponent(event.binder_id)}` }, { headers })
}
