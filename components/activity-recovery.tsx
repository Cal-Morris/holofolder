"use client"

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { sameActivityScope, storedActivityScope, type ActivityEvent, type ActivityScope } from '@/lib/collection-activity'
import { readableActivityChanges } from '@/lib/activity-presentation'
import { recoveryExplanation, type RecoveryPreview, type RecoveryReceipt } from '@/lib/domain/activity-recovery'
import { readRecoveryRequest, recoveryRequestKey, saveRecoveryRequest } from '@/lib/activity-recovery-request'

export function ActivityRecovery({event,scope,disabled,undone,onRecovered,onInvalidScope}:{event:ActivityEvent;undone:boolean;scope:ActivityScope;disabled:boolean;onRecovered:()=>Promise<void>;onInvalidScope:()=>void}) {
  const router=useRouter()
  const [preview,setPreview]=useState<RecoveryPreview|null>(null)
  const [request,setRequest]=useState(()=>readRecoveryRequest(localStorage,scope,event.id))
  const [receipt,setReceipt]=useState<RecoveryReceipt|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [verified,setVerified]=useState(false)
  const active=useRef(true)
  const running=useRef(false)
  useEffect(()=>{active.current=true;return ()=>{active.current=false}},[])
  const isCurrent=()=>active.current && sameActivityScope(storedActivityScope(localStorage),scope)
  async function send(operation:'preview'|'apply',input:unknown) {
    const response=await fetch(`/app/api/collection-activity/recovery?operation=${operation}`,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Binder-Owner':scope.ownerId},body:JSON.stringify(input),signal:AbortSignal.timeout(12000)})
    const value=await response.json()
    if(!isCurrent()) throw new Error('Your collection access changed. Reopen Activity.')
    if(response.status===401||response.status===403) {onInvalidScope();throw new Error('Sign in again to undo this change.')}
    if(!response.ok) {
      if(operation==='apply' && response.status<500 && response.status!==429) {
        localStorage.removeItem(recoveryRequestKey(scope,event.id));setRequest(null);setPreview(null)
      }
      throw new Error(response.status===409 ? 'This change can no longer be undone as reviewed. Check the latest activity.' : typeof value.error==='string' ? value.error : 'Undo is unavailable. Try again.')
    }
    return value
  }
  async function verify() {
    await onRecovered()
    if(!isCurrent())return
    localStorage.removeItem(recoveryRequestKey(scope,event.id))
    setRequest(null);setVerified(true);router.refresh()
  }
  async function run(apply:boolean) {
    if(disabled || running.current)return
    running.current=true;setBusy(true);setError(null)
    try {
      if(apply) {
        const intent=request ?? (preview?.planToken ? {eventId:event.id,restoreUnassignedItemIds:preview.restoreUnassignedItemIds,planVersion:1 as const,planToken:preview.planToken,operationId:crypto.randomUUID(),confirmed:true as const} : null)
        if(!intent)return
        // Save before sending: closing/reloading or a lost response must retry the same intent.
        saveRecoveryRequest(localStorage,scope,intent);setRequest(intent)
        const saved=await send('apply',intent) as RecoveryReceipt
        if(saved.recoveredEventId!==event.id || typeof saved.eventId!=='string')throw new Error('Undo could not be verified. Retry to check its result.')
        setReceipt(saved);await verify()
        window.dispatchEvent(new Event('holofolder-activity-updated'))
      } else {
        const value=await send('preview',{eventId:event.id,restoreUnassignedItemIds:[]}) as RecoveryPreview
        if(value.eventId!==event.id || !Array.isArray(value.changes)||!Array.isArray(value.conflicts)||!Array.isArray(value.unsupported))throw new Error('Undo could not be checked. Try again.')
        setPreview(value)
      }
    } catch(e) {if(isCurrent())setError(e instanceof Error ? e.message : 'Could not reach the server. Retry to check whether Undo was saved.')}
    finally {running.current=false;if(active.current)setBusy(false)}
  }
  const changes=preview ? readableActivityChanges({...event,changes:preview.changes,before_state:null,after_state:null}) : []
  const button='inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-50'
  if(receipt) return <div className={verified ? "col-start-2 row-start-1 py-2 text-xs text-muted-foreground" : "col-span-2 mt-2 rounded-xl bg-muted/60 p-3 text-xs"} role="status">
    <p>{verified ? 'Undone' : 'Undo saved. Refresh the collection to finish checking it.'}</p>
    {error && <p className="mt-1 text-destructive">{error}</p>}
    {!verified && <button type="button" className={button} disabled={busy||disabled} onClick={()=>void run(true)}>Retry verification</button>}
  </div>
  if(undone && !request) return <p className="col-start-2 row-start-1 py-2 text-xs text-muted-foreground" role="status">Undone</p>
  return <>
    {!preview && <button type="button" disabled={disabled||busy} className={`${button} col-start-2 row-start-1 self-start text-primary hover:bg-muted`} onClick={()=>void run(!!request)}><RotateCcw className="h-3.5 w-3.5" aria-hidden/>{busy ? 'Checking…' : request ? 'Retry Undo' : 'Undo'}</button>}
    {error && <p role="alert" className="col-span-2 mt-1 text-xs text-destructive">{error}</p>}
    {preview && <div className="col-span-2 mt-2 min-w-0 rounded-xl border border-border p-3 text-xs wrap-anywhere" role="region" aria-label="Review Undo">
      <p className="font-medium">{preview.planToken ? 'Undo this change?' : 'Cannot undo this change'}</p>
      {preview.planToken ? <>
        <ul className="mt-2 space-y-2">{changes.slice(0,10).map((c,i)=><li key={i}><p>{c.title}</p>{c.subtitle && <p className="text-muted-foreground">{c.subtitle}</p>}{c.fields.map(f=><p key={f.label} className="text-muted-foreground">{f.label}: {f.before} → {f.after}</p>)}</li>)}</ul>
        {changes.length>10 && <p className="mt-2">And {changes.length-10} more changes. The entire change will be undone together.</p>}
        <div className="mt-2 flex gap-2"><button type="button" disabled={disabled||busy} className={`${button} bg-primary text-primary-foreground`} onClick={()=>void run(true)}>{busy ? 'Undoing…' : request ? 'Retry Undo' : 'Undo this change'}</button><button type="button" disabled={busy||!!request} className={button} onClick={()=>setPreview(null)}>Cancel</button></div>
      </> : <><p className="mt-2 text-muted-foreground">{recoveryExplanation(preview.conflicts[0]?.reason ?? preview.unsupported[0] ?? '')}</p><button type="button" className={button} onClick={()=>setPreview(null)}>Close</button></>}
    </div>}
  </>
}
