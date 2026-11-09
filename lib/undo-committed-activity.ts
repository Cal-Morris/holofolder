import { ACTIVITY_SCOPE_KEY, normalizeActivityScope, sameActivityScope, storedActivityScope } from '@/lib/collection-activity'
import { readRecoveryRequest, saveRecoveryRequest, recoveryRequestKey } from '@/lib/activity-recovery-request'
import { recoveryExplanation, type RecoveryPreview } from '@/lib/domain/activity-recovery'

/** A snackbar click confirms the just-shown action; the server still previews and checks it. */
export async function undoCommittedActivity(eventId:string,accountId:string,ownerId:string,isCurrent:()=>boolean,onRecovered:()=>Promise<void>) {
  const access=await fetch('/app/api/collection-activity?scope=1',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)})
  if(!access.ok)throw new Error('Reconnect and open Activity to undo this change.')
  const scope=normalizeActivityScope((await access.json()).scope)
  if(!isCurrent()||!scope||scope.accountId!==accountId||scope.ownerId!==ownerId)throw new Error('Your collection access changed. Reopen Activity.')
  localStorage.setItem(ACTIVITY_SCOPE_KEY,JSON.stringify(scope))
  async function send(operation:string,body:unknown) {
    if(!isCurrent()||!sameActivityScope(storedActivityScope(localStorage),scope))throw new Error('Your collection access changed. Reopen Activity.')
    const response=await fetch(`/app/api/collection-activity/recovery?operation=${operation}`,{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Binder-Owner':ownerId},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)})
    const value=await response.json()
    if(!response.ok)throw new Error(typeof value.error==='string' ? value.error : 'Could not undo. Open Activity to check this change.')
    if(!isCurrent())throw new Error('Your account changed. Reopen Activity.')
    return value
  }
  let request=readRecoveryRequest(localStorage,scope,eventId)
  if(!request) {
    const preview=await send('preview',{eventId,restoreUnassignedItemIds:[]}) as RecoveryPreview
    if(!preview.planToken)throw new Error(recoveryExplanation(preview.conflicts[0]?.reason??preview.unsupported[0]??''))
    request={eventId,restoreUnassignedItemIds:[],planVersion:1,planToken:preview.planToken,operationId:crypto.randomUUID(),confirmed:true}
    saveRecoveryRequest(localStorage,scope,request)
  }
  const result=await send('apply',request)
  if(result.recoveredEventId!==eventId || typeof result.eventId!=='string')throw new Error('Could not verify Undo. Retry to check the result.')
  await onRecovered()
  if(!isCurrent())throw new Error('Your account changed. Reopen Activity.')
  localStorage.removeItem(recoveryRequestKey(scope,eventId))
}
