import {createClient} from '@supabase/supabase-js'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
import {validateMcpClaims} from '@/lib/developer-api/oauth'
export type McpIdentity=ReturnType<typeof validateMcpClaims>&{expiresAt:number}
/** Local only: the access token's ES256 signature against the cached JWKS, then issuer, audience, role and expiry. */
export async function verifyMcpToken(token:string):Promise<McpIdentity> {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL!
 const client=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data,error}=await client.auth.getClaims(token)
 if(error || !data?.claims) throw new DeveloperAccessError('invalid_oauth_token','Connect this MCP client through Holo Folder OAuth.',401)
 return {...validateMcpClaims(data.claims,`${url}/auth/v1`),expiresAt:Number(data.claims.exp)}
}
