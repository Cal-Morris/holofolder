import { recoveryApplySchema, type RecoveryRequest } from '@/lib/domain/activity-recovery'
import { sameActivityScope, storedActivityScope, type ActivityScope } from '@/lib/collection-activity'

export const recoveryRequestKey=(scope:ActivityScope,eventId:string)=>`holofolder_activity_undo_v1:${JSON.stringify([scope.accountId,scope.ownerId,scope.membershipKey,eventId])}`
export function readRecoveryRequest(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,scope:ActivityScope,eventId:string):RecoveryRequest|null {
  try {
    if(!sameActivityScope(storedActivityScope(storage),scope)) return null
    const parsed=recoveryApplySchema.safeParse(JSON.parse(storage.getItem(recoveryRequestKey(scope,eventId))??'null'))
    return parsed.success && parsed.data.eventId===eventId ? parsed.data : null
  } catch {return null}
}
export function saveRecoveryRequest(storage:Pick<Storage,'setItem'|'getItem'|'removeItem'>,scope:ActivityScope,request:RecoveryRequest) {
  if(!sameActivityScope(storedActivityScope(storage),scope)) throw new Error('Your collection access changed. Reopen Activity.')
  storage.setItem(recoveryRequestKey(scope,request.eventId),JSON.stringify(request))
}
