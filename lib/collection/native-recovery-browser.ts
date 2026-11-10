import { isRecoveryRejection } from './recovery-rejection'
import { appPath } from '@/lib/app-path'
import { parseNativeRecoveryRequest, type NativeRecoveryOperation } from '@/lib/domain/native-recovery'
import { parseActivityPage, type ActivityChange } from '@/lib/collection-activity'
import { isContractRecord } from '@/lib/domain/binder-slots'
import { sameInventoryReadScope, type InventoryReadScope } from '@/lib/collection/inventory-read-transport'
import { parseNativeRecoveryReceipt } from './native-recovery-intent'

export interface NativeRecoveryPreview {
  planVersion: 1 | 2; eventId: string; supported: boolean; unsupported: string[]
  conflicts: {reason:string;entity?:string}[]; planToken: string | null; restoreUnassignedItemIds: string[]; changes: ActivityChange[]
}
export async function sendNativeRecovery(operation: NativeRecoveryOperation, input: unknown, currentScope: () => InventoryReadScope | null, localHarness = false) {
  const scope = currentScope()
  if (!scope || !navigator.onLine) throw new Error('Reconnect to review or retry recovery. Your saved request is retained.')
  const captured = {...scope}, request = parseNativeRecoveryRequest(operation,input)
  const response = await fetch(appPath(`${localHarness ? '/e2e-harness/storage/recovery' : '/api/native-recovery'}?operation=${operation}`), {
    method:'POST', credentials:'same-origin', cache:'no-store', redirect:'error', signal:AbortSignal.timeout(30000),
    headers:{'Content-Type':'application/json','X-Binder-Owner':captured.ownerUserId,'X-Binder-Auth-Session':captured.authSessionId}, body:JSON.stringify(request),
  })
  const value: unknown = await response.json()
  if (!sameInventoryReadScope(currentScope(),captured)) throw new Error('Collection access changed. Reopen Activity in the original account.')
  const cache = response.headers.get('cache-control')?.split(/\s*,\s*/)
  if (!cache?.includes('private') || !cache.includes('no-store') || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Recovery reply could not be verified.')
  if (response.status === 409 && (operation === 'recovery.apply' || operation === 'recovery.apply.v2')
    && isContractRecord(value,['version','operation','operationId','rejection']) && Object.keys(value).length === 4
    && value.version === 1 && value.operation === operation && value.operationId === request.operationId
    && isRecoveryRejection(value.rejection,String(request.operationId))) return value.rejection
  if (!response.ok) throw new Error(response.status === 409 ? 'Storage changed or the result is unknown. A confirmed request is retained for exact retry.' : 'Recovery is unavailable. Any confirmed request is still saved on this device.')
  if (!isContractRecord(value,['version','operation','operationId','receipt','preview','requestId']) || value.version !== 1 || value.operation !== operation) throw new Error('Recovery reply could not be verified.')
  if (operation === 'recovery.apply' || operation === 'recovery.apply.v2') {
    if (value.operationId !== request.operationId) throw new Error('Recovery reply identity changed.')
    return parseNativeRecoveryReceipt(value.receipt, request.eventId)
  }
  const p = value.preview
  if (!isContractRecord(p,['planVersion','eventId','supported','unsupported','conflicts','planToken','restoreUnassignedItemIds','changes','rootRevisionsAdvance'])
    || p.eventId !== request.eventId || p.planVersion !== (operation.endsWith('.v2') ? 2 : 1) || typeof p.supported !== 'boolean'
    || !Array.isArray(p.unsupported) || !p.unsupported.every(v=>typeof v==='string') || !Array.isArray(p.conflicts)
    || !p.conflicts.every(c=>isContractRecord(c,['reason','entity']) && typeof c.reason==='string' && (c.entity === undefined || typeof c.entity === 'string'))
    || !Array.isArray(p.changes) || p.rootRevisionsAdvance !== true
    || !Array.isArray(p.restoreUnassignedItemIds) || JSON.stringify(p.restoreUnassignedItemIds) !== JSON.stringify(request.restoreUnassignedItemIds)
    || !(p.planToken === null || typeof p.planToken === 'string' && /^[a-f0-9]{64}$/.test(p.planToken))
    || p.planToken !== null && (!p.supported || p.unsupported.length > 0 || p.conflicts.length > 0)) throw new Error('Recovery preview could not be verified.')
  const page = parseActivityPage({data:[{id:p.eventId,recorded_at:'',changes:p.changes}],nextCursor:null})
  if (!page) throw new Error('Recovery changes could not be verified.')
  return {...p,changes:page.data[0].changes} as unknown as NativeRecoveryPreview
}
