"use client"

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { activityChanges, type ActivityEvent } from '@/lib/collection-activity'
import { recoveryExplanation } from '@/lib/domain/activity-recovery'
import { nativeRecoveryOperation, type NativeRecoveryIntent, type RetainedRecovery } from '@/lib/collection/native-recovery-intent'
import { sendNativeRecovery, type NativeRecoveryPreview } from '@/lib/collection/native-recovery-browser'
import type { createSlotOfflineQueue, SlotOfflineScope } from '@/lib/collection/slot-offline-queue'
import type { InventoryReadScope } from '@/lib/collection/inventory-read-transport'
import type { InventorySnapshot } from '@/lib/domain/inventory'

export interface NativeRecoveryBinding {
  scope: InventoryReadScope
  queue: ReturnType<typeof createSlotOfflineQueue> | null
  currentScope: () => InventoryReadScope | null
  activeQueueScope: () => SlotOfflineScope | null
  readCurrent: () => Promise<InventorySnapshot>
  refresh: () => Promise<void>
  deviceId: string
  localHarness: boolean
  snapshot: InventorySnapshot | null
}
export function NativeActivityRecovery({event,binding,disabled}: {event:ActivityEvent;binding:NativeRecoveryBinding;disabled:boolean}) {
  const [preview,setPreview] = useState<NativeRecoveryPreview|null>(null)
  const [saved,setSaved] = useState<RetainedRecovery|null>(null)
  const [choices,setChoices] = useState<string[]>([])
  const [replacement,setReplacement] = useState('')
  const [reviewedRequest,setReviewedRequest] = useState<Record<string,unknown>|null>(null)
  const [error,setError] = useState('')
  const [terminalReviewed,setTerminalReviewed] = useState(false)
  const [busy,setBusy] = useState(false)
  const alive = useRef(false), running = useRef(false)
  const confirmedIntent = useRef<NativeRecoveryIntent | null>(null)
  const latest = useRef(binding)
  useLayoutEffect(()=>{latest.current = binding})
  useEffect(()=>{alive.current=true;void binding.queue?.read().then(r=>{if(alive.current)setSaved(r.recovery?.findLast(v=>v.intent.request.eventId===event.id) ?? null)}).catch(()=>{if(alive.current)setError('Saved requests could not be opened. Recovery is unavailable.')});return()=>{alive.current=false}},[binding.queue,event.id])
  const current = () => alive.current && latest.current.currentScope() !== null
  async function run(retry = false) {
    if (running.current || disabled || !binding.queue || !current()) return
    running.current=true;setBusy(true);setError('')
    try {
      if (retry || reviewedRequest && preview?.planToken) {
        let retained = saved
        if (!retained) {
          if (!reviewedRequest || !preview?.planToken) return
          const intent = confirmedIntent.current ?? {operation:nativeRecoveryOperation(true,preview.planVersion) as 'recovery.apply'|'recovery.apply.v2',
            request:{...reviewedRequest,planVersion:preview.planVersion,planToken:preview.planToken,operationId:crypto.randomUUID(),confirmed:true},
            context:{source:'app' as const,clientId:binding.deviceId,clientOccurredAt:new Date().toISOString()}}
          // Keep the confirmed identity through a failed local commit.
          confirmedIntent.current = intent
          // Await the IDB transaction BEFORE acknowledging confirmation or sending anything.
          await binding.queue.retainRecovery(intent,binding.activeQueueScope)
          retained = { intent, receipt: null, synchronized: false, lease: null }
          if (!current()) return
          setSaved(retained);setPreview(null);setReviewedRequest(null)
          await binding.refresh()
        }
        const verified = await binding.queue.replayRecovery(String(retained.intent.request.operationId),
          intent=>sendNativeRecovery(intent.operation,intent.request,latest.current.currentScope,binding.localHarness),binding.readCurrent,binding.activeQueueScope)
        if (!current()) return
        const record = await binding.queue.read()
        setSaved(record.recovery!.find(r=>r.intent.request.operationId===retained!.intent.request.operationId)!)
        setTerminalReviewed(verified === true)
        await binding.refresh()
        if (record.recovery!.find(r=>r.intent.request.operationId===retained!.intent.request.operationId)?.synchronized) window.dispatchEvent(new Event('holofolder-activity-updated'))
      } else {
        // Preview always begins with a newly authorized complete read, never a cached snapshot.
        const snapshot = await binding.readCurrent()
        if (!current()) return
        const target = snapshot.collections.find(c=>c.id===replacement)
        const layout = snapshot.binders.find(b=>b.collectionId===replacement)
        const version = replacement ? 2 : 1
        const request = replacement ? {eventId:event.id,planVersion:2,restoreUnassignedItemIds:[],replacementDefaultCollectionId:replacement,inventoryRevision:snapshot.inventoryRevision,
          collections:[{collectionId:target?.id,version:target?.version,layoutRevision:layout?.layoutRevision}]} : {eventId:event.id,restoreUnassignedItemIds:choices}
        const value = await sendNativeRecovery(nativeRecoveryOperation(false,version),request,binding.currentScope,binding.localHarness) as NativeRecoveryPreview
        if (!current()) return
        confirmedIntent.current=null;setPreview(value);setReviewedRequest(request)
      }
    } catch(e) {
      if (current() && binding.queue) {
        const record = await binding.queue.read().catch(()=>null)
        if (current() && record) setSaved(record.recovery?.findLast(r=>r.intent.request.eventId===event.id) ?? null)
      }
      if(current())setError(e instanceof Error ? e.message : 'Recovery unavailable. Any confirmed request is retained.')}
    finally {running.current=false;if(alive.current)setBusy(false)}
  }
  async function discard() {
    if (running.current || !saved?.rejection || !terminalReviewed || !binding.queue || !current()) return
    running.current=true;setBusy(true);setError('')
    try {
      await binding.queue.discardRecovery(String(saved.intent.request.operationId),binding.readCurrent,binding.activeQueueScope)
      if (!current()) return
      const record = await binding.queue.read()
      if (!current()) return
      setSaved(record.recovery!.find(r=>r.intent.request.operationId===saved.intent.request.operationId)!)
      confirmedIntent.current=null;setTerminalReviewed(false)
      await binding.refresh()
    } catch(e) {if(current())setError(e instanceof Error ? e.message : 'Saved recovery could not be resolved. Original request and proof are retained.')}
    finally {running.current=false;if(alive.current)setBusy(false)}
  }
  const button = 'min-h-10 rounded-lg border border-border px-3 text-xs disabled:opacity-50'
  const removed = event.changes.filter(c=>c.table==='inventory_items' && c.before && !c.after)
  const defaultCreation = event.action==='collection.create' && event.changes.some(c=>c.table==='binders' && !c.before && c.after?.is_default===true)
  const description = preview ? activityChanges({...event,changes:preview.changes,before_state:null,after_state:null}) : []
  return <div className="col-span-2 mt-2 min-w-0 space-y-2 text-xs wrap-anywhere" aria-label="Recovery">
    {saved ? <>
      <p role="status">{saved.resolution === 'discarded' ? 'Recovery did not commit. Saved request discarded, original request and proof retained.' : saved.rejection ? 'Recovery did not commit. Review current storage before discarding this saved request.' : saved.synchronized ? 'Recovery verified against current storage.' : saved.receipt ? 'Recovery accepted. Current storage still needs verification.' : 'Recovery saved on this device. The shared result is not yet verified.'}</p>
      {!saved.synchronized && saved.resolution !== 'discarded' && <button type="button" className={button} disabled={disabled||busy} onClick={()=>void run(true)}>{busy ? 'Checking recovery…' : saved.rejection ? 'Refresh current storage' : saved.receipt ? 'Verify current storage' : 'Retry exact recovery'}</button>}
      {saved.rejection && saved.resolution !== 'discarded' && terminalReviewed && <section aria-label="Review noncommitted recovery" className="space-y-2">
        <p>The original recovery changed nothing. Discard only this saved request, or keep it for later. A new recovery needs a fresh preview and confirmation.</p>
        <button type="button" className={button} disabled={disabled||busy} onClick={()=>void discard()}>Discard noncommitted recovery</button>
      </section>}
      {saved.resolution === 'discarded' && <button type="button" className={button} disabled={disabled||busy} onClick={()=>{confirmedIntent.current=null;setSaved(null);setPreview(null);setReviewedRequest(null);setChoices([]);setReplacement('')}}>Review new recovery</button>}
      {saved.receipt && <p>Recovery entry {saved.receipt.eventId}, original entry {saved.receipt.recoveredEventId}.</p>}
    </> : <>
      {removed.length>0 && <fieldset disabled={busy||disabled||!!preview} className="space-y-1"><legend>Removed ownership</legend><p className="text-muted-foreground">Choose only copies to restore as Unassigned. No new acquisition or automatic placement is created.</p>{removed.map(c=><label key={c.id} className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={choices.includes(c.id)} onChange={e=>setChoices(v=>e.target.checked?[...v,c.id]:v.filter(id=>id!==c.id))}/>Restore {c.id} as Unassigned</label>)}</fieldset>}
      {defaultCreation && <label className="block">Replacement default collection<select className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-2 text-sm" value={replacement} disabled={busy||!!preview} onChange={e=>{setReplacement(e.target.value);setChoices([])}}><option value="">Choose explicitly</option>{binding.snapshot?.collections.filter(c=>!event.affected_entities.collectionIds?.includes(c.id) && binding.snapshot?.binders.some(b=>b.collectionId===c.id)).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {!preview && <button type="button" className={button} disabled={disabled||busy||!binding.queue||defaultCreation&&!replacement} onClick={()=>void run()}>{busy ? 'Checking recovery…' : 'Review recovery'}</button>}
      {preview && <section role="region" aria-label="Review recovery" className="space-y-2 rounded-xl border border-border p-3">
        <p className="font-medium">{preview.planToken ? 'Review the complete recovery' : 'Recovery unavailable'}</p>
        <div className="flex flex-wrap gap-2">{preview.planToken && <button type="button" className={`${button} bg-primary text-primary-foreground`} disabled={disabled||busy} onClick={()=>void run()}>Confirm recovery</button>}<button type="button" className={button} disabled={busy} onClick={()=>{confirmedIntent.current=null;setPreview(null);setReviewedRequest(null)}}>{preview.planToken ? 'Cancel review' : 'Close review'}</button></div>
        {description.map((c,i)=><div key={i}><p>{c.title}</p>{c.fields.map(f=><p key={f.label}>{f.label}: {f.before} → {f.after}</p>)}</div>)}
        {[...preview.unsupported,...preview.conflicts.map(c=>c.reason)].map((reason,i)=><p key={i}>{recoveryExplanation(reason)} <span className="text-muted-foreground">({reason})</span></p>)}
      </section>}
    </>}
    {disabled && <p role="status">Reconnect with current access and finish pending edits to review recovery.</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>
}
