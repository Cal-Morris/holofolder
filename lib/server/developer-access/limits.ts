import {createHmac} from 'node:crypto'
import {createAdminClient} from '@/lib/supabase/admin'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
async function consumeBudget(bucket:string,limit:number) {
 const {data,error}=await createAdminClient().rpc('consume_developer_budget',{budget_bucket:bucket,request_limit:limit})
 if(error||typeof data?.allowed!=='boolean')throw new Error('Request budget unavailable')
 if(!data.allowed)throw new DeveloperAccessError('rate_limited','Request limit reached. Try again shortly.',429,Number(data.retry_after)||60)
}
export async function consumeDeveloperLimit(actorId:string,kind:'read'|'write') {
 return consumeBudget(`${actorId}:${kind}`,kind==='read'?60:20)
}
export function developerPreauthBucket(request:Request):string|null {
 if(process.env.VERCEL!=='1')return null
 // Vercel supplies this header; behind Framer it may identify a proxy.
 const ip=request.headers.get('x-vercel-forwarded-for')??'unknown'
 const digest=createHmac('sha256',process.env.SUPABASE_SERVICE_ROLE_KEY!).update(ip.slice(0,200)).digest('hex')
 return `preauth:${digest}`
}
export async function consumeDeveloperPreauth(request:Request) {
 const bucket=developerPreauthBucket(request)
 if(bucket)await consumeBudget(bucket,1000)
}
