import { getFirstPartyUser } from "@/lib/supabase/session-user"
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/session-user'
import { SHOW_MODE_IDLE_MS } from '@/lib/show-mode'
import { normalizePushSubscription } from '@/lib/partner-push'
import { missingPushSchema, pushConfigured } from '@/lib/server/partner-push'

const headers = { 'cache-control': 'private, no-store' }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export async function GET() {
  const user = await getSessionUser(await createClient())
  if (!user) return Response.json({ error: 'Sign in to manage notifications.' }, { status: 401, headers })
  const { data, error } = await createAdminClient().from('push_subscriptions').select('id,endpoint,label,created_at,last_seen_at').eq('user_id', user.id).order('created_at')
  if (missingPushSchema(error)) return Response.json({ configured: false, devices: [] }, { headers })
  if (error) return Response.json({ error: 'Could not load your devices.' }, { status: 503, headers })
  return Response.json({ configured: pushConfigured(), devices: data ?? [] }, { headers })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await getFirstPartyUser(supabase)
  if (!user) return Response.json({ error: 'Sign in to enable notifications.' }, { status: 401, headers })
  if (!pushConfigured()) return Response.json({ error: 'Partner notifications are not available yet.' }, { status: 503, headers })
  const raw = await request.text()
  if (raw.length > 8192) return Response.json({ error: 'Invalid device subscription.' }, { status: 400, headers })
  let body: unknown
  try { body = JSON.parse(raw) } catch { return Response.json({ error: 'Invalid device subscription.' }, { status: 400, headers }) }
  const device = normalizePushSubscription(body)
  if (!device) return Response.json({ error: 'Invalid device subscription.' }, { status: 400, headers })
  const { data, error } = await createAdminClient().rpc('register_push_subscription', {
    p_user: user.id, p_endpoint: device.endpoint, p_p256dh: device.p256dh, p_auth: device.auth, p_label: device.label,
  })
  if (error) return Response.json({ error: missingPushSchema(error) ? 'Partner notifications are not available yet.' : 'Could not register this device. Remove an old device or disable notifications here, then try again.' }, { status: missingPushSchema(error) ? 503 : 409, headers })
  return Response.json({ id: data }, { headers })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await getFirstPartyUser(supabase)
  if (!user) return Response.json({ error: 'Sign in to manage notifications.' }, { status: 401, headers })
  const body = await request.json().catch(() => null)
  if (!body || (!uuid(body.id) && typeof body.endpoint !== 'string')) return Response.json({ error: 'Choose a registered device.' }, { status: 400, headers })
  let query = createAdminClient().from('push_subscriptions').delete().eq('user_id', user.id)
  query = uuid(body.id) ? query.eq('id', body.id) : query.eq('endpoint', body.endpoint)
  const { error } = await query
  if (error && !missingPushSchema(error)) return Response.json({ error: 'Could not remove this device.' }, { status: 503, headers })
  return new Response(null, { status: 204, headers })
}

export async function PATCH(request: Request) {
  const { data: { user } } = await getFirstPartyUser(await createClient())
  if (!user) return Response.json({ error: 'Sign in to manage notifications.' }, { status: 401, headers })
  const body = await request.json().catch(() => null)
  if (!body || typeof body.endpoint !== 'string' || !body.endpoint || body.endpoint.length > 2048 || typeof body.showMode !== 'boolean') {
    return Response.json({ error: 'Invalid Show mode device.' }, { status: 400, headers })
  }
  const { error } = await createAdminClient().from('push_subscriptions')
    .update({ show_mode_until: body.showMode ? new Date(Date.now() + SHOW_MODE_IDLE_MS).toISOString() : null })
    .eq('user_id', user.id).eq('endpoint', body.endpoint)
  if (error) return Response.json({ error: 'Could not update Show mode notifications.' }, { status: 503, headers })
  return new Response(null, { status: 204, headers })
}
