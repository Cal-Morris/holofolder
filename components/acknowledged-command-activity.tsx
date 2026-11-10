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
  return <div className="space-y-2 px-4 py-2 text-sm" aria-label="Acknowledged command history">
    <label className="block">Synchronized change<select aria-label="Synchronized change" className="mt-1 min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-sm" value={operationId} onChange={e => setSelected(e.target.value)}>
      {operations.map((id, i) => <option key={id} value={id}>{i === 0 ? 'Latest · ' : ''}{id}</option>)}
    </select></label>
    <ActivityButton filter={{ operationId }} label="Find acknowledged change" />
    <p className="text-xs text-muted-foreground">Find its recorded event before reviewing recovery. Newer edits may prevent recovery.</p>
  </div>
}
