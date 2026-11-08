import { getFirstPartyUser } from "@/lib/supabase/session-user"
import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/supabase/session-user'
import { requireAppearanceOrigin } from '@/lib/server/binder-appearance'
export const billingHeaders = { 'Cache-Control': 'private, no-store' }
export async function billingUser(request: Request, write = false) {
  if (write) requireAppearanceOrigin(request)
  const client = await createClient()
  return write ? (await getFirstPartyUser(client)).data.user : getSessionUser(client)
}
