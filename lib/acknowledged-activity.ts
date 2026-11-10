import type { ActivityPage } from '@/lib/collection-activity'
import type { SlotOfflineRecord, SlotOfflineScope } from '@/lib/collection/slot-offline-queue'

/** These historical ACKs already passed the queue's separate fresh complete-read fence. */
export function acknowledgedActivityOperations(record: SlotOfflineRecord | null, scope: SlotOfflineScope): string[] {
  if (!record || Object.keys(scope).some(key => record.scope[key as keyof SlotOfflineScope] !== scope[key as keyof SlotOfflineScope])) return []
  return record.receipts.filter(r => r.outcome === 'acknowledged' && ['slots', 'inventory'].includes(r.intent.kind)
    && r.operationId === r.intent.request.operationId).map(r => r.operationId).toReversed()
}

/** Membership-authorized server history alone resolves an operation to an event. */
export function operationActivityMatch(page: ActivityPage, operationId: string, eventId?: string | null, hasPreviousPage = false): 'unavailable' | 'single' | 'multiple' {
  if (!page.data.length || page.data.some(event => event.operation_id !== operationId || eventId && event.id !== eventId)) return 'unavailable'
  if (eventId && (page.data.length !== 1 || page.nextCursor)) return 'unavailable'
  return page.data.length === 1 && !page.nextCursor && !hasPreviousPage ? 'single' : 'multiple'
}
