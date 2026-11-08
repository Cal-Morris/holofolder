import { getBillingAccess } from '@/lib/server/billing'
import { RetryableError } from 'workflow'
import { createAdminClient } from '@/lib/supabase/admin'
import webpush from 'web-push'

export async function partnerAcquisitionPush(eventId: string) {
  'use workflow'
  const devices = await recipientDevices(eventId)
  const results = await Promise.allSettled(devices.map(id => deliver(eventId, id)))
  await complete(eventId)
  return { devices: devices.length, delivered: results.filter(r => r.status === 'fulfilled' && r.value === 'delivered').length }
}

async function recipientDevices(eventId: string) {
  'use step'
  const admin = createAdminClient()
  const { data: event, error } = await admin.from('partner_acquisitions').select('recipient_id,created_at,owner_user_id').eq('id', eventId).maybeSingle()
  if (error) throw new Error('Could not read partner update')
  if (!event || Date.now() - Date.parse(event.created_at) > 24 * 60 * 60 * 1000) return [] as string[]
  const access = await getBillingAccess(event.owner_user_id)
  if (access.enforced && access.tier !== 'paid') return [] as string[]
  const { data, error: deviceError } = await admin.from('push_subscriptions').select('id').eq('user_id', event.recipient_id).gt('show_mode_until', new Date().toISOString())
  if (deviceError?.code === '42703') return [] as string[]
  if (deviceError) throw new Error('Could not read recipient devices')
  return (data ?? []).map(row => String(row.id))
}

async function deliver(eventId: string, subscriptionId: string): Promise<'delivered' | 'skipped' | 'failed'> {
  'use step'
  const admin = createAdminClient()
  const { data: token, error } = await admin.rpc('claim_partner_push', { p_event: eventId, p_subscription: subscriptionId })
  if (error) throw new Error('Could not claim partner delivery')
  if (!token) {
    const { data: delivery } = await admin.from('partner_push_deliveries').select('delivered_at,lease_until,attempts').eq('event_id', eventId).eq('subscription_id', subscriptionId).maybeSingle()
    if (delivery && !delivery.delivered_at && delivery.attempts < 4 && Date.parse(delivery.lease_until ?? '') > Date.now()) {
      throw new RetryableError('Another delivery is in progress', { retryAfter: 31_000 })
    }
    return 'skipped'
  }
  const [{ data: event, error: eventError }, { data: subscription, error: subscriptionError }] = await Promise.all([
    admin.from('partner_acquisitions').select('actor_name,card_name,binder_id,pokemon_id,recipient_id,owner_user_id').eq('id', eventId).maybeSingle(),
    admin.from('push_subscriptions').select('user_id,endpoint,p256dh,auth,show_mode_until').eq('id', subscriptionId).maybeSingle(),
  ])
  if (eventError || subscriptionError) throw new Error('Could not read delivery details')
  if (!event || !subscription || subscription.user_id !== event.recipient_id || !(Date.parse(subscription.show_mode_until ?? '') > Date.now())) return 'skipped'
  const access = await getBillingAccess(event.owner_user_id)
  if (access.enforced && access.tier !== 'paid') return 'skipped'
  let status = 201
  try {
    await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({
      recipientId: event.recipient_id, eventId, tag: `acquisition:${eventId}`,
    }), {
      vapidDetails: { subject: process.env.VAPID_SUBJECT!, publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
      TTL: 3600, timeout: 10_000,
    })
  } catch (error) {
    status = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0
    if (status === 404 || status === 410) {
      await admin.from('push_subscriptions').delete().eq('id', subscriptionId)
      return 'skipped'
    }
    await admin.from('partner_push_deliveries').update({ lease_until: null, last_status: status }).eq('event_id', eventId).eq('subscription_id', subscriptionId).eq('lease_token', token)
    if (!status || status === 429 || status >= 500) throw new RetryableError('Push service is temporarily unavailable', { retryAfter: 15_000 })
    return 'failed'
  }
  const { error: markError } = await admin.from('partner_push_deliveries').update({ delivered_at: new Date().toISOString(), lease_until: null, last_status: status }).eq('event_id', eventId).eq('subscription_id', subscriptionId).eq('lease_token', token)
  if (markError) throw new Error('Could not record delivery')
  return 'delivered'
}

async function complete(eventId: string) {
  'use step'
  const { error } = await createAdminClient().from('partner_acquisitions').update({ completed_at: new Date().toISOString() }).eq('id', eventId)
  if (error) throw new Error('Could not complete partner update')
}
