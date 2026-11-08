import { createClient } from '@/lib/supabase/server'
import { requireAppearanceOrigin } from '@/lib/server/binder-appearance'
import { DeveloperAccessError } from '@/lib/developer-api/permissions'
export async function requireDeveloperSettingsUser(request:Request, write=false) {
 if(write) requireAppearanceOrigin(request)
 const client=await createClient()
 const {data:claims,error:claimsError}=await client.auth.getClaims()
 if(claimsError || !claims?.claims?.sub || claims.claims.client_id) throw new DeveloperAccessError('sign_in_required','Sign in to manage developer access.',401)
 const {data:{user},error}=await client.auth.getUser()
 if(error || !user) throw new DeveloperAccessError('sign_in_required','Sign in to manage developer access.',401)
 return {client,user}
}
