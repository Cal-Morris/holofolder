import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/supabase/session-user'
import { readCollectionAnalytics } from '@/lib/server/operations/analytics'
export async function GET(request:Request) {
 const client=await createClient()
 const user=await getSessionUser(client)
 if(!user)return Response.json({error:'Not authenticated'},{status:401,headers:{'Cache-Control':'private, no-store'}})
 return readCollectionAnalytics(request,user)
}
