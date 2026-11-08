import {protectedResourceMetadata} from '@/lib/server/mcp/metadata'
export function GET() {
 return Response.json(protectedResourceMetadata(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`),{headers:{'Cache-Control':'public, max-age=3600','Access-Control-Allow-Origin':'*'}})
}
