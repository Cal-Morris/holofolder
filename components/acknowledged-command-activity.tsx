'use client'

import { useState } from 'react'
import { ActivityButton } from '@/components/collection-activity-context'
import { acknowledgedActivityOperations } from '@/lib/acknowledged-activity'
import type { SlotOfflineRecord, SlotOfflineScope } from '@/lib/collection/slot-offline-queue'

export function AcknowledgedCommandActivity({ record, scope }: { record: SlotOfflineRecord | null; scope: SlotOfflineScope }) {
  const [selected, setSelected] = useState('')
  const operations = acknowledgedActivityOperations(record, scope)
  const operationId = operations.includes(selected) ? selected : operations[0]
  if (!operationId) return null
  // Recent changes are named by how recent they are; their IDs stay internal and exact.
  return <details className="space-y-2 px-4 py-2 text-sm" aria-label="Recent changes">
    <summary className="min-h-11 cursor-pointer py-3 font-medium">Recent changes</summary>
    <label className="block">Which change<select aria-label="Synchronized change" className="mt-1 min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-sm" value={operationId} onChange={e => setSelected(e.target.value)}>
      {operations.map((id, i) => <option key={id} value={id}>{i === 0 ? 'My latest change' : i === 1 ? 'The change before that' : `${i + 1} changes ago`}</option>)}
    </select></label>
    <ActivityButton filter={{ operationId }} label="Show in Activity" />
    <p className="text-xs text-muted-foreground">Activity shows what changed and whether it can still be undone.</p>
  </details>
}
