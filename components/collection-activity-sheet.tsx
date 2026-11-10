"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss, runAfterOverlayHistory } from "@/hooks/use-overlay"
import { activityChanges, activityActor, activityCacheKey, activityTime, parseActivityPage, readActivityCache, sameActivityScope, writeActivityCache, type ActivityEvent, type ActivityScope } from "@/lib/collection-activity"
import { activitySummary, activityReceipt, activityDay } from "@/lib/activity-presentation"
import { NativeActivityRecovery, type NativeRecoveryBinding } from "@/components/native-activity-recovery"
import { isNativeRecoveryEvent } from "@/lib/collection/native-recovery-intent"
import { ActivityRecovery } from "@/components/activity-recovery"
import type { ActivityInitialFilter } from "@/components/collection-activity-context"
import type { Binder } from "@/lib/binders/model"
import { operationActivityMatch } from "@/lib/acknowledged-activity"
import type { CollectedPokemon } from "@/lib/domain/cards"

interface Props {
  nativeRecovery?: NativeRecoveryBinding
  onSelectEvent?: (id:string)=>void
  scope:ActivityScope|null; initialFilter:ActivityInitialFilter; binderId:string|null; binders:readonly Binder[]; collection:readonly CollectedPokemon[]
  pendingCount:number; isOnline:boolean; onRecovered:()=>Promise<void>; onClose:()=>void; onInvalidScope:()=>void; onVerify:()=>void; onOpenPokemon:(id:number)=>void
}
const control = 'min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-sm'

export default function CollectionActivitySheet(props:Props) {
  const {scope,initialFilter,binderId,binders,pendingCount,isOnline,onClose} = props
  const panel = useRef<HTMLDivElement|null>(null)
  useOverlay(true,onClose,{containerRef:panel})
  const swipe = useSwipeToDismiss(panel,onClose)
  const [filters,setFilters] = useState(()=>new URLSearchParams(initialFilter.operationId ? {limit:'50',operationId:initialFilter.operationId} : {limit:'50',...(binderId ? {collectionId:binderId} : {}),...(initialFilter.pokemonId ? {pokemonId:String(initialFilter.pokemonId)} : {}),...(initialFilter.inventoryItemId ? {inventoryItemId:initialFilter.inventoryItemId} : {})}).toString())
  const [showFilters,setShowFilters] = useState(false)
  const [revision,setRevision] = useState(0)
  useEffect(()=>{
    const updated=()=>setRevision(v=>v+1)
    window.addEventListener('holofolder-activity-updated',updated)
    return()=>window.removeEventListener('holofolder-activity-updated',updated)
  },[])
  const apply = (event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const params = new URLSearchParams({limit:'50'})
    for (const [key,value] of data) if (typeof value==='string' && value.trim()) {
      params.set(key==='collectionIdText' ? 'collectionId' : key==='actorIdText' ? 'actorId' : key==='actionText' ? 'action' : key,['since','until'].includes(key) ? new Date(`${value}${key==='since'?'T00:00:00.000Z':'T23:59:59.999Z'}`).toISOString() : value.trim())
    }
    setFilters(params.toString());setShowFilters(false)
  }
  const selected = new URLSearchParams(filters)
  return createPortal(<div className="fixed inset-0 z-40" >
    <div data-overlay-backdrop className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose}/>
    <section ref={panel} role="dialog" aria-modal="true" aria-label="Collection Activity" className="absolute inset-x-0 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-0.5rem)] w-full max-w-lg flex-col rounded-t-3xl border border-border bg-card text-foreground shadow-xl sm:rounded-3xl">
      <header data-sheet-grabber className="shrink-0 px-4 pt-3 pb-2" {...swipe}>
        <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold">Activity</h2><button type="button" aria-label="Close Activity" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted" onClick={onClose}><X className="h-4 w-4"/></button></div>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 text-sm [overflow-wrap:anywhere]">
        {pendingCount>0 && <p role="status" className="mb-3 rounded-xl bg-muted/60 p-3 text-xs">{pendingCount} {pendingCount===1 ? 'change waiting' : 'changes waiting'} to sync. {props.nativeRecovery ? 'Recovery needs acknowledged history and a supported current preview.' : 'Undo will be available once they’re saved.'}</p>}
        <div className="mb-2 flex gap-2">{!initialFilter.operationId && <button type="button" className="min-h-10 rounded-lg border border-border px-3" aria-expanded={showFilters} onClick={()=>setShowFilters(v=>!v)}>Filters</button>}<button type="button" className="min-h-10 rounded-lg border border-border px-3" disabled={!isOnline} onClick={()=>{if(scope)setRevision(v=>v+1);else props.onVerify()}}>Refresh</button></div>
        {initialFilter.operationId && <p className="mb-2 text-xs wrap-anywhere">Acknowledged operation {initialFilter.operationId}. History lookup does not undo this change.</p>}
        <p className="mb-2 text-xs text-muted-foreground">{selected.has('collectionId') ? binders.find(b=>b.id===selected.get('collectionId'))?.name ?? 'Previous collection' : selected.has('id') ? 'Selected change' : selected.has('recoveryOfEventId') ? 'Undo history' : 'All collections'}{selected.has('pokemonId') ? ` · Pokémon #${selected.get('pokemonId')}` : ''}{selected.has('inventoryItemId') ? ' · Selected copy' : ''}</p>
        {showFilters && <form onSubmit={apply} className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-border p-3">
          <label className="col-span-2 text-xs">Collection<select name="collectionId" defaultValue={selected.get('collectionId') ?? ''} className={control}><option value="">All collections</option>{binders.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="col-span-2 text-xs">Person<select name="actorId" defaultValue={selected.get('actorId') ?? ''} className={control}><option value="">Everyone</option>{scope && <option value={scope.accountId}>You</option>}{scope?.memberIds?.filter(id=>id!==scope.accountId).map(id=><option key={id} value={id}>Collection partner</option>)}</select></label>
          <label className="text-xs">From (UTC)<input type="date" name="since" defaultValue={selected.get('since')?.slice(0,10)} className={control}/></label>
          <label className="text-xs">Through (UTC)<input type="date" name="until" defaultValue={selected.get('until')?.slice(0,10)} className={control}/></label>
          <label className="col-span-2 text-xs">Action<select name="action" defaultValue={selected.get('action') ?? ''} className={control}><option value="">All changes</option><option value="collection_item">Cards and wanted lists</option><option value="collection_change">Collections and settings</option><option value="legacy">Older recorded changes</option></select></label>
          <button type="submit" className="col-span-2 min-h-10 rounded-lg bg-primary px-3 font-medium text-primary-foreground">Apply filters</button>
        </form>}
        {scope ? <ActivityResults key={`${JSON.stringify(scope)}:${filters}:${revision}`} {...props} scope={scope} query={filters} onSelectEvent={id=>setFilters(new URLSearchParams({id}).toString())} /> : <p role="status" className="py-4">{isOnline ? 'Verifying current collection access. If this does not load, use Refresh history to retry.' : 'History is not cached for this account and collection access. Reconnect to load it.'}</p>}
      </div>
    </section>
  </div>,document.body)
}

function ActivityResults(props:Props & {scope:ActivityScope;query:string}) {
  const {query} = props
  const [cursor,setCursor] = useState<string|null>(null)
  const [previous,setPrevious] = useState<Array<string|null>>([])
  const params = new URLSearchParams(query)
  if(cursor)params.set('cursor',cursor)
  const pageQuery = params.toString()
  return <div>
    <ActivityPageView key={pageQuery} {...props} pageQuery={pageQuery} onNext={next=>{setPrevious(v=>[...v,cursor]);setCursor(next)}} />
    {previous.length>0 && <div className="mt-3 flex gap-2"><button type="button" className="min-h-10 rounded-lg border border-border px-3" onClick={()=>{setCursor(previous.at(-1) ?? null);setPrevious(v=>v.slice(0,-1))}}>Newer page</button></div>}
    {/* Each page owns its older cursor; no client-side filtering or offset pagination. */}
  </div>
}

function ActivityPageView({scope,pageQuery,isOnline,onInvalidScope,onNext,...props}:Props & {scope:ActivityScope;pageQuery:string;onNext:(cursor:string)=>void}) {
  const key = activityCacheKey(scope,pageQuery)
  const [saved,setSaved] = useState(()=>readActivityCache(localStorage,scope,key))
  const [loading,setLoading] = useState(isOnline)
  const [cached,setCached] = useState(true)
  const [error,setError] = useState<string|null>(null)
  useEffect(()=>{
    if (!isOnline) return
    let cancelled = false
    const abort = new AbortController()
    const timeout = window.setTimeout(()=>abort.abort(),8000)
    void fetch(`/app/api/collection-activity?${pageQuery}`,{cache:'no-store',credentials:'same-origin',signal:abort.signal}).then(async response=>{
      const value = await response.json()
      if(cancelled)return
      if(response.status===401 || response.status===403) {onInvalidScope();return}
      if(!response.ok) throw new Error(typeof value.error==='string' ? value.error : 'History is unavailable. Reconnect and refresh.')
      if(!sameActivityScope(scope,value.scope)) {onInvalidScope();return}
      const page = parseActivityPage(value)
      if (!page || typeof value.syncedAt!=='string') throw new Error('History could not be read.')
      if (props.initialFilter.operationId && page.data.length && operationActivityMatch(page,props.initialFilter.operationId,new URLSearchParams(pageQuery).get('id')) === 'unavailable') throw new Error('Exact operation history could not be verified. No recovery is offered.')
      setSaved({page,syncedAt:value.syncedAt});setCached(false)
      writeActivityCache(localStorage,scope,key,page,value.syncedAt)
    }).catch(error=>{if(!cancelled)setError(error instanceof Error && error.name!=='AbortError' ? error.message : 'History request timed out. Refresh to try again.')})
      .finally(()=>{window.clearTimeout(timeout);if(!cancelled)setLoading(false)})
    return ()=>{cancelled=true;abort.abort();window.clearTimeout(timeout)}
  },[scope,pageQuery,isOnline,key,onInvalidScope,props.initialFilter.operationId])
  const linked = props.initialFilter.operationId
  const selectedEvent = new URLSearchParams(pageQuery).get('id')
  const match = saved && linked ? operationActivityMatch(saved.page,linked,selectedEvent,new URLSearchParams(pageQuery).has('cursor')) : null
  // Cached history never establishes this operation's exact event.
  const linkedReady = !linked || !cached && isOnline && !loading && !error && (match === 'single' || match === 'multiple')
  return <>
    {loading && <p role="status" className="py-2 text-xs">Loading activity…</p>}
    {error && <p role="alert" className="my-2 rounded-lg bg-destructive/10 p-3 text-sm">{error}</p>}
    {linked && !loading && !error && (!linkedReady || match === 'unavailable') && <p role="status" className="py-2">Exact operation history is unavailable. Reconnect and refresh; no recovery is offered.</p>}
    {linked && linkedReady && match === 'multiple' && <p role="status" className="py-2">Multiple events match this operation. Inspect and select an exact entry; no event was chosen automatically.</p>}
    {linked && linkedReady && match === 'single' && !selectedEvent && <p role="status" className="py-2">One event matches this operation. Open the exact entry to inspect recovery.</p>}
    {saved && (cached || !isOnline) && <p className="mb-3 text-xs text-muted-foreground">Saved activity · Last updated {activityTime(saved.syncedAt)}. Reconnect for the latest changes and Undo.</p>}
    {!saved && !loading && <p className="py-4">{!isOnline ? 'Connect to load this activity.' : 'Couldn’t load activity. Try Refresh.'}</p>}
    {saved?.page.data.length===0 && <p className="py-4">{cached || !isOnline ? 'No saved activity on this page. Reconnect to check for more.' : 'No activity matches these filters.'}</p>}
    <ol className="space-y-2" aria-label="Committed activity">{linkedReady && saved?.page.data.map((event,index)=>{
      const day=activityDay(event.recorded_at)
      return <ActivityEntry key={event.id} event={event} inspectOnly={!!linked && !selectedEvent} undone={saved.page.data.some(other=>other.recovery_of_event_id===event.id)} day={index===0 || day!==activityDay(saved.page.data[index-1].recorded_at) ? day : undefined} {...props} scope={scope} isOnline={isOnline} onInvalidScope={onInvalidScope}/>
    })}</ol>
    {linkedReady && saved?.page.nextCursor && <button type="button" className="mt-3 min-h-10 rounded-lg border border-border px-3" onClick={()=>onNext(saved.page.nextCursor!)}>Older page</button>}
  </>
}

function ActivityEntry({event,day,undone,binders,collection,binderId,isOnline,pendingCount,onClose,onOpenPokemon,scope,onRecovered,onInvalidScope,nativeRecovery,onSelectEvent,inspectOnly}:Props & {event:ActivityEvent;day?:string;undone:boolean;inspectOnly?:boolean}) {
  const [expanded,setExpanded] = useState(false)
  const [count,setCount] = useState(10)
  const summary=activitySummary(event,binders)
  const receipt=activityReceipt(event)
  const changes=nativeRecovery ? activityChanges(event).map(c=>({...c,subtitle:''})) : receipt.changes
  const hasDetails=nativeRecovery ? changes.length>0 : receipt.hasDetails
  const canUndo=receipt.canUndo
  const first=event.changes[0]
  const state=first?.after ?? first?.before
  const pokemonId=event.pokemon_id ?? (typeof state?.pokemon_id==='number' ? state.pokemon_id : null)
  const liveItem=summary.count===1 && first?.table==='pokemon_collection' && event.affected_entities.collectionIds?.includes(binderId ?? '')
    ? collection.find(item=>item.pokemon_id===pokemonId && item.id===first.id) : undefined
  const person=activityActor(event,scope?.accountId,scope?.memberIds)
  return <li>
    {day && <h3 className="pt-3 pb-2 text-xs font-medium text-muted-foreground">{day}</h3>}
    <article className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-xl border border-border/70 bg-background/50 p-3">
      <div className="min-w-0 wrap-anywhere">
        {liveItem ? <button type="button" className="min-h-10 text-left text-sm font-medium leading-snug text-primary hover:underline" onClick={()=>{onClose();runAfterOverlayHistory(()=>onOpenPokemon(liveItem.pokemon_id))}}>{summary.title}</button> : <p className="text-sm font-medium leading-snug">{summary.title}</p>}
        {summary.subtitle && <p className="mt-1 text-xs text-muted-foreground">{summary.subtitle}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{person.startsWith('Account ') ? 'Previous member' : person} · <time dateTime={event.recorded_at}>{new Date(event.recorded_at).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</time></p>
      </div>
      {!inspectOnly && scope && !nativeRecovery && canUndo && <ActivityRecovery undone={undone} event={event} scope={scope} disabled={!isOnline||pendingCount>0} onRecovered={onRecovered} onInvalidScope={onInvalidScope}/>}
      {!inspectOnly && nativeRecovery && isNativeRecoveryEvent(event) && <NativeActivityRecovery event={event} binding={nativeRecovery} disabled={!isOnline||pendingCount>0}/>}
      {!inspectOnly && nativeRecovery && !isNativeRecoveryEvent(event) && <p className="col-span-2 mt-2 text-xs text-muted-foreground">Recovery is unavailable for this kind of change in this view. Open its original collection view to use supported Undo.</p>}
      {inspectOnly && <button type="button" className="col-span-2 mt-2 min-h-10 rounded-lg border border-border px-3 text-xs" onClick={()=>onSelectEvent?.(event.id)}>Open exact entry {event.id}</button>}
      {event.recovery_of_event_id && <p className="col-span-2 mt-2 text-xs text-muted-foreground"><button type="button" className="min-h-10 underline" onClick={()=>onSelectEvent?.(event.recovery_of_event_id!)}>Open original entry {event.recovery_of_event_id}</button></p>}
      {hasDetails && <div className="col-span-2 min-w-0">
        <button type="button" aria-expanded={expanded} className="mt-1 min-h-10 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted" onClick={()=>setExpanded(v=>!v)}>{expanded ? 'Hide changes' : summary.count>1 ? `View ${summary.count} changes` : 'View changes'}</button>
        {expanded && <div className="mt-2 space-y-3 border-t border-border/60 pt-3 text-xs wrap-anywhere">
          {changes.slice(0,count).map((change,index)=><section key={index} className="rounded-lg bg-muted/40 p-3">
            {summary.count>1 && <h4 className="font-medium">{change.title}</h4>}
            {change.subtitle && summary.count>1 && <p className="mt-1 text-muted-foreground">{change.subtitle}</p>}
            {change.fields.length>0 && <dl className="space-y-2">{change.fields.map(field=><div key={field.label}><dt className="text-muted-foreground">{field.label}</dt><dd className="mt-0.5">{field.before} <span className="px-1 text-muted-foreground" aria-label="changed to">→</span> {field.after}</dd></div>)}</dl>}
          </section>)}
          {changes.length>count && <button type="button" className="min-h-10 rounded-lg border border-border px-3" onClick={()=>setCount(c=>c+25)}>Show more changes ({changes.length-count} remaining)</button>}
        </div>}
      </div>}
    </article>
  </li>
}
