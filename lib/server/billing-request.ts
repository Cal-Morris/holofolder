import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/supabase/session-user'
import { requireAppearanceOrigin } from '@/lib/server/binder-appearance'
export const billingHeaders = { 'Cache-Control': 'private, no-store' }
export async function billingUser(request: Request, write = false) {
  if (write) requireAppearanceOrigin(request)
  const client = await createClient()
  return write ? (await client.auth.getUser()).data.user : getSessionUser(client)
}
