import { getFirstPartyUser } from "@/lib/supabase/session-user"
import webpush from 'web-push'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { pushConfigured } from '@/lib/server/partner-push'

const headers = { 'cache-control': 'private, no-store' }

export async function POST(request: Request) {
  const { data: { user } } = await getFirstPartyUser(await createClient())
  if (!user) return Response.json({ error: 'Sign in to test notifications.' }, { status: 401, headers })
  if (!pushConfigured()) return Response.json({ error: 'Partner notifications are not available yet.' }, { status: 503, headers })
  const raw = await request.text()
  let body
  try { body = raw.length <= 8192 ? JSON.parse(raw) : null } catch { body = null }
  if (!body || typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) {
    return Response.json({ error: 'Choose a registered device.' }, { status: 400, headers })
  }
  const { data: device, error } = await createAdminClient().from('push_subscriptions')
    .select('endpoint,p256dh,auth').eq('id', body.id).eq('user_id', user.id).maybeSingle()
  if (error) return Response.json({ error: 'Could not load this notification device.' }, { status: 503, headers })
  if (!device) return Response.json({ error: 'This device is no longer registered. Enable notifications again.' }, { status: 404, headers })
  try {
    await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, JSON.stringify({
      kind: 'test', recipientId: user.id, tag: 'holofolder-test',
    }), {
      vapidDetails: { subject: process.env.VAPID_SUBJECT!, publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
      TTL: 60, timeout: 10_000,
    })
  } catch (error) {
    const status = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0
    console.warn('[holofolder] Test push was not accepted', { status })
    return Response.json({ error: 'Test notification could not be sent. Your device is still registered; try again or remove it and enable it again.' }, { status: 502, headers })
  }
  return Response.json({ sent: true }, { headers })
}
