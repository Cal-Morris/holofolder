import {createClient} from '@supabase/supabase-js'
import {createAdminClient} from '@/lib/supabase/admin'
import {DeveloperAccessError,normalizePermissions} from '@/lib/developer-api/permissions'
import {validateMcpClaims,validateMcpOrigin} from '@/lib/developer-api/oauth'
import type {DeveloperPrincipal} from '@/lib/developer-api/types'
export async function authenticateMcpToken(token:string,origin?:string|null):Promise<DeveloperPrincipal> {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL!
 const client=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data,error}=await client.auth.getClaims(token)
 if(error || !data?.claims) throw new DeveloperAccessError('invalid_oauth_token','Connect this MCP client through Holo Folder OAuth.',401)
 const identity=validateMcpClaims(data.claims,`${url}/auth/v1`)
 const {data:grant,error:grantError}=await createAdminClient().rpc('verify_developer_oauth_session',{session:identity.sessionId,actor:identity.actorId,client:identity.clientId,grant_version:identity.grantId})
 if(grantError) throw new Error('OAuth grant lookup unavailable')

 if(!grant) throw new DeveloperAccessError('oauth_revoked','This MCP connection has expired or been revoked. Connect again.',401)
 validateMcpOrigin(origin,grant.redirect_origin)
 return {actorId:identity.actorId,credentialId:grant.id,transport:'mcp',oauth:{sessionId:identity.sessionId,clientId:identity.clientId,expiresAt:Number(data.claims.exp)},permissions:normalizePermissions(grant.permissions)}
}
