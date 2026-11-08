import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validateMcpClaims} from '@/lib/developer-api/oauth'
const claims={iss:'https://synthetic.supabase.co/auth/v1',sub:'00000000-0000-4000-8000-000000000001',client_id:'00000000-0000-4000-8000-000000000002',session_id:'00000000-0000-4000-8000-000000000003',developer_grant_id:'00000000-0000-4000-8000-000000000004',aud:'https://holofolder.com/app/mcp',role:'holo_mcp',exp:2000000000}
test('MCP accepts only the exact resource, issuer and complete OAuth identity',()=>{
 assert.equal(validateMcpClaims(claims,claims.iss,1000).clientId,claims.client_id)
 for(const patch of [{aud:'authenticated'},{role:'authenticated'},{iss:'https://attacker.test'},{exp:999},{client_id:undefined},{session_id:'invalid'},{developer_grant_id:undefined}]) assert.throws(()=>validateMcpClaims({...claims,...patch},claims.iss,1000))
})

test('MCP browser origins are bound to the consenting client, opaque origins are denied',async()=>{
 const {validateMcpOrigin}=await import('@/lib/developer-api/oauth')
 validateMcpOrigin(undefined,'https://synthetic-client.test')
 validateMcpOrigin('https://holofolder.com','https://synthetic-client.test')
 validateMcpOrigin('https://synthetic-client.test','https://synthetic-client.test')
 assert.throws(()=>validateMcpOrigin('https://attacker.test','https://synthetic-client.test'))
 assert.throws(()=>validateMcpOrigin('null','null'))
})
