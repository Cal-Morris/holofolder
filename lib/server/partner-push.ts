import { createAdminClient } from '@/lib/supabase/admin'
import type { AcquisitionIntent } from '@/lib/partner-push'

export function pushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT)
}
export function missingPushSchema(error: { code?: string } | null | undefined) {
  return Boolean(error && ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code ?? ''))
}

export async function saveCollectionWithAcquisition(input: {
  ownerId: string; binderId: string | null; actorId: string; actorName: string; pokemonId: number
  row: Record<string, unknown>; expected: unknown; acquisition: AcquisitionIntent | undefined
}) {
  if (!input.binderId) return null
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('save_collection_with_acquisition', {
    p_owner: input.ownerId, p_binder: input.binderId, p_actor: input.actorId,
    p_pokemon: input.pokemonId, p_row: input.row, p_expected: input.expected,
    p_acquisition: input.acquisition ?? null, p_actor_name: input.actorName,
  })
  if (missingPushSchema(error)) return null
  if (error) throw new Error('Could not save the collection change')
  if (!data || typeof data !== 'object' || (!data.conflict && !data.item)) throw new Error('Invalid collection save response')
  return data
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
