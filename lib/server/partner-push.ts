import { createAdminClient } from '@/lib/supabase/admin'

export function pushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT)
}
export function missingPushSchema(error: { code?: string } | null | undefined) {
  return Boolean(error && ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code ?? ''))
}

export async function startPendingPartnerPush(actorId: string) {
  if (!pushConfigured()) return 0
  const admin = createAdminClient()
  const { data: events, error } = await admin.from('partner_acquisitions').select('id')
    .eq('actor_id', actorId).is('started_at', null).order('created_at').limit(20)
  if (missingPushSchema(error)) return 0
  if (error) throw new Error('Could not read pending partner updates')
  if (!events?.length) return 0
  if (process.env.VERCEL === '1') process.env.WORKFLOW_TARGET_WORLD = 'vercel'
  const [{ start }, { partnerAcquisitionPush }] = await Promise.all([import('workflow/api'), import('@/workflows/partner-acquisition-push')])
  let started = 0
  for (const event of events) {
    try {
      await start(partnerAcquisitionPush, [event.id])
      const { error: markError } = await admin.from('partner_acquisitions').update({ started_at: new Date().toISOString() }).eq('id', event.id).eq('actor_id', actorId).is('started_at', null)
      if (!markError) started++
    } catch {
      // The pending event remains recoverable if durable workflow acceptance fails.
      console.warn('[binderdex] Partner push remains pending', { eventId: event.id })
    }
  }
  return started
}
