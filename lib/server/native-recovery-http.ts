import { isRecoveryRejection } from '@/lib/collection/recovery-rejection'
import 'server-only'
import { randomUUID } from 'node:crypto'
import { executeAppStorageRequest } from '@/lib/server/operations/storage-execution'
import { parseActivityPage } from '@/lib/collection-activity'
import type { NativeRecoveryOperation } from '@/lib/domain/native-recovery'
import { parseStorageRequest } from '@/lib/server/operations/storage-contract'
import { requireAppearanceOrigin } from '@/lib/server/binder-appearance'
import { readDeveloperJson, developerErrorResponse } from '@/lib/server/developer-access/request'
import { DeveloperAccessError } from '@/lib/developer-api/permissions'

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' }
/** Internal first-party bridge. Only the existing loopback harness calls this handler. */
export async function handleNativeRecovery(request: Request, localClients?: Parameters<typeof executeAppStorageRequest>[2]) {
  const requestId = randomUUID()
  try {
    if (request.method !== 'POST') return Response.json({ error: 'recovery_method' }, { status: 405, headers })
    if (!request.headers.get('origin') || !request.headers.get('X-Binder-Auth-Session') || !request.headers.get('X-Binder-Owner')) throw new DeveloperAccessError('recovery_scope_required','Use the current signed-in app session.',403)
    requireAppearanceOrigin(request)
    const operation = new URL(request.url).searchParams.get('operation') as NativeRecoveryOperation
    if (!['recovery.preview','recovery.apply','recovery.preview.v2','recovery.apply.v2'].includes(operation)) throw new DeveloperAccessError('invalid_input','Choose a native recovery operation.',400)
    const input = parseStorageRequest(operation, await readDeveloperJson(request, 1048576))
    const receipt = await executeAppStorageRequest(new Request(request.url, { method:'POST', headers:request.headers, body:JSON.stringify(input) }), operation, localClients)
    if (operation === 'recovery.preview' || operation === 'recovery.preview.v2') {
      // Reuse the public-safe Activity field allowlist after the executor's private-key guard.
      const safe = parseActivityPage({data:[{id:receipt.eventId,recorded_at:'',changes:receipt.changes}],nextCursor:null})
      if (!safe) throw new Error('invalid-preview')
      if (!Array.isArray(receipt.conflicts) || !receipt.conflicts.every(c=>c && typeof c === 'object' && typeof c.reason === 'string' && (c.entity === undefined || typeof c.entity === 'string'))) throw new Error('invalid-conflicts')
      const conflicts = receipt.conflicts.map(c=>({reason:c.reason,...(c.entity === undefined ? {} : {entity:c.entity})}))
      return Response.json({version:1,operation,requestId,preview:{...receipt,changes:safe.data[0].changes,conflicts}},{headers})
    }
    if (isRecoveryRejection(receipt,String(input.operationId))) return Response.json({version:1,operation,operationId:input.operationId,rejection:receipt},{status:409,headers})
    return Response.json({version:1,operation,operationId:input.operationId,receipt},{headers})
  } catch (error) {
    const response = developerErrorResponse(error,requestId)
    for (const [key,value] of Object.entries(headers)) response.headers.set(key,value)
    return response
  }
}
