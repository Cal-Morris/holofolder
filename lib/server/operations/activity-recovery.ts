import 'server-only'
import { randomUUID } from 'node:crypto'
import { withAuditActor, withAuditOperation } from '@/lib/server/audit-context'
import { requireDeveloperSettingsUser } from '@/lib/server/developer-access/first-party'
import { requireExpectedAppearanceOwner, AppearanceError } from '@/lib/server/binder-appearance'
import { resolveCollectionMembership } from '@/lib/server/collection-owner'
import { readDeveloperJson } from '@/lib/server/developer-access/request'
import { DeveloperAccessError, requirePermissions } from '@/lib/developer-api/permissions'
import type { OperationContext } from '@/lib/developer-api/types'
import { recoveryApplySchema, recoveryPreviewSchema } from '@/lib/domain/activity-recovery'
import { parseActivityPage } from '@/lib/collection-activity'
import { normalizeStorageResult, storageExecutionError } from './storage-contract'
import { isAuditId } from './audit'

type RecoveryOperation='preview'|'apply'
export async function executeActivityRecovery(operation:RecoveryOperation,ownerId:string,input:unknown) {
  const parsed=(operation==='apply' ? recoveryApplySchema : recoveryPreviewSchema).safeParse(input)
  if(!parsed.success) throw new DeveloperAccessError('invalid_input','Review this change before undoing it.',400)
  const operationId='operationId' in parsed.data ? String(parsed.data.operationId) : randomUUID()
  const {createAdminClient}=await import('@/lib/supabase/admin')
  return withAuditOperation(operationId,async()=>{
    const {data,error}=await createAdminClient().rpc('collection_recovery_v1',{operation,owner_id:ownerId,request:parsed.data}).abortSignal(AbortSignal.timeout(10000))
    if(error) throw storageExecutionError(error)
    if(!data || typeof data!=='object' || Array.isArray(data)) throw storageExecutionError(null)
    if(operation==='apply') {
      if(!isAuditId(data.eventId)||data.recoveredEventId!==parsed.data.eventId) throw storageExecutionError(null)
      return {eventId:data.eventId,recoveredEventId:data.recoveredEventId}
    }
    // Reuse the existing private-field guard, then the safe Activity allowlist.
    if(typeof data.rootRevisionsAdvance!=='boolean') throw storageExecutionError(null)
    const clean=normalizeStorageResult('recovery.preview',{...data,rootRevisionsAdvance:true})
    if(clean.eventId!==parsed.data.eventId) throw storageExecutionError(null)
    const page=parseActivityPage({data:[{id:clean.eventId,recorded_at:'',changes:clean.changes}],nextCursor:null})
    if(!page) throw storageExecutionError(null)
    return {...clean,rootRevisionsAdvance:data.rootRevisionsAdvance,changes:page.data[0].changes}
  })
}
export async function developerActivityRecovery(context:OperationContext,operation:RecoveryOperation,input:unknown) {
  requirePermissions(context.principal.permissions,['collection:read','collection:write','binders:write'])
  return withAuditActor(context.principal.actorId,()=>executeActivityRecovery(operation,context.ownerUserId,input),context)
}
export async function firstPartyRecovery(request:Request) {
  const headers={'Cache-Control':'private, no-store',Vary:'Cookie'}
  try {
    const {user,client}=await requireDeveloperSettingsUser(request,true)
    const membership=await resolveCollectionMembership(client,user.id)
    requireExpectedAppearanceOwner(request,membership.ownerUserId)
    const operation=new URL(request.url).searchParams.get('operation')
    if(operation!=='preview'&&operation!=='apply') throw new DeveloperAccessError('invalid_input','Choose preview or apply.',400)
    const input=await readDeveloperJson(request,1048576)
    const result=await withAuditActor(user.id,()=>executeActivityRecovery(operation,membership.ownerUserId,input))
    return Response.json(result,{headers})
  } catch(error) {
    const known=error instanceof DeveloperAccessError || error instanceof AppearanceError
    return Response.json({error:known ? error.message : 'Undo is temporarily unavailable. Try again.',code:known ? error.code : 'recovery_unavailable'},{status:known ? error.status : 503,headers})
  }
}
