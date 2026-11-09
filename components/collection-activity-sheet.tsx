"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss, runAfterOverlayHistory } from "@/hooks/use-overlay"
import { OverlayLink } from "@/components/overlay-link"
import { activityActor, activityCacheKey, activityChanges, activitySource, activityTime, parseActivityPage, readActivityCache, sameActivityScope, writeActivityCache, type ActivityEvent, type ActivityScope } from "@/lib/collection-activity"
import { activitySummary, readableActivityChanges, activityDay } from "@/lib/activity-presentation"
import { ActivityRecovery } from "@/components/activity-recovery"
import type { ActivityInitialFilter } from "@/components/collection-activity-context"
import type { Binder } from "@/lib/binders/model"
import type { CollectedPokemon } from "@/lib/domain/cards"

interface Props {
  scope:ActivityScope|null; initialFilter:ActivityInitialFilter; binderId:string|null; binders:readonly Binder[]; collection:readonly CollectedPokemon[]
  pendingCount:number; isOnline:boolean; onRecovered:()=>Promise<void>; onOpenEvent?:(id:string,related?:boolean)=>void; onClose:()=>void; onInvalidScope:()=>void; onVerify:()=>void; onOpenPokemon:(id:number)=>void
}
const control = 'min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-sm'

export default function CollectionActivitySheet(props:Props) {
  const {scope,initialFilter,binderId,binders,pendingCount,isOnline,onClose} = props
  const panel = useRef<HTMLDivElement|null>(null)
  useOverlay(true,onClose,{containerRef:panel})
  const swipe = useSwipeToDismiss(panel,onClose)
  const [filters,setFilters] = useState(()=>new URLSearchParams({limit:'50',...(binderId ? {collectionId:binderId} : {}),...(initialFilter.pokemonId ? {pokemonId:String(initialFilter.pokemonId)} : {}),...(initialFilter.itemId ? {itemId:initialFilter.itemId} : {})}).toString())
  const [showFilters,setShowFilters] = useState(false)
  const [revision,setRevision] = useState(0)
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
        {pendingCount>0 && <p role="status" className="mb-3 rounded-xl bg-muted/60 p-3 text-xs">{pendingCount} {pendingCount===1 ? 'change waiting' : 'changes waiting'} to sync. Undo will be available once they’re saved.</p>}
        <div className="mb-2 flex gap-2"><button type="button" className="min-h-10 rounded-lg border border-border px-3" aria-expanded={showFilters} onClick={()=>setShowFilters(v=>!v)}>Filters</button><button type="button" className="min-h-10 rounded-lg border border-border px-3" disabled={!isOnline} onClick={()=>{if(scope)setRevision(v=>v+1);else props.onVerify()}}>Refresh</button></div>
        <p className="mb-2 text-xs text-muted-foreground">{selected.has('collectionId') ? binders.find(b=>b.id===selected.get('collectionId'))?.name ?? 'Previous collection' : selected.has('id') ? 'Selected change' : selected.has('recoveryOfEventId') ? 'Undo history' : 'All collections'}{selected.has('pokemonId') ? ` · Pokémon #${selected.get('pokemonId')}` : ''}{selected.has('itemId') ? ' · Selected card' : ''}</p>
        {showFilters && <form onSubmit={apply} className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-border p-3">
          <label className="col-span-2 text-xs">Collection<select name="collectionId" defaultValue={selected.get('collectionId') ?? ''} className={control}><option value="">All collections</option>{binders.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="col-span-2 text-xs">Person<select name="actorId" defaultValue={selected.get('actorId') ?? ''} className={control}><option value="">Everyone</option>{scope && <option value={scope.accountId}>You</option>}{scope?.memberIds?.filter(id=>id!==scope.accountId).map(id=><option key={id} value={id}>Collection partner</option>)}</select></label>
          <label className="text-xs">From (UTC)<input type="date" name="since" defaultValue={selected.get('since')?.slice(0,10)} className={control}/></label>
          <label className="text-xs">Through (UTC)<input type="date" name="until" defaultValue={selected.get('until')?.slice(0,10)} className={control}/></label>
          <label className="col-span-2 text-xs">Action<select name="action" defaultValue={selected.get('action') ?? ''} className={control}><option value="">All changes</option><option value="collection_item">Cards and wanted lists</option><option value="collection_change">Collections and settings</option><option value="legacy">Older recorded changes</option></select></label>
          <details className="col-span-2"><summary className="min-h-10 cursor-pointer py-2 text-xs">Advanced filters</summary><div className="grid grid-cols-2 gap-2 pt-2">
          <label className="col-span-2 text-xs">Actor account ID<input name="actorIdText" defaultValue={selected.get('actorId') && !scope?.memberIds?.includes(selected.get('actorId')!) && selected.get('actorId')!==scope?.accountId ? selected.get('actorId')! : ''} className={control} placeholder="Another recorded account"/></label>
          <label className="col-span-2 text-xs">Recorded action<input name="actionText" defaultValue={selected.get('action') && !['collection_item','collection_change','legacy'].includes(selected.get('action')!) ? selected.get('action')! : ''} className={control}/></label>
          <label className="col-span-2 text-xs">Card printing ID<input name="cardId" defaultValue={selected.get('cardId') ?? ''} className={control} placeholder="e.g. base1-4"/></label>
          <label className="text-xs">Owned item ID<input name="itemId" defaultValue={selected.get('itemId') ?? ''} className={control}/></label>
          <label className="text-xs">Slot ID<input name="slotId" defaultValue={selected.get('slotId') ?? ''} className={control}/></label>
          <label className="text-xs">Pokémon number<input name="pokemonId" inputMode="numeric" defaultValue={selected.get('pokemonId') ?? ''} className={control}/></label>
          <label className="text-xs">Collection ID<input name="collectionIdText" defaultValue="" className={control} placeholder="Deleted or existing ID"/></label>
          <p className="col-span-2 text-xs text-muted-foreground">Exact recorded IDs/actions, searched on the server across all pages. Older entries without entity IDs cannot match those filters. Pokémon filters include retained legacy deltas.</p>
          </div></details>
          <button type="submit" className="col-span-2 min-h-10 rounded-lg bg-primary px-3 font-medium text-primary-foreground">Apply filters</button>
        </form>}
        {scope ? <ActivityResults key={`${filters}:${revision}`} {...props} scope={scope} query={filters} onOpenEvent={(id,related)=>setFilters(related ? new URLSearchParams({limit:"50",recoveryOfEventId:id}).toString() : id ? new URLSearchParams({id}).toString() : new URLSearchParams({limit:'50',...(binderId ? {collectionId:binderId} : {})}).toString())} /> : <p role="status" className="py-4">{isOnline ? 'Verifying current collection access. If this does not load, use Refresh history to retry.' : 'History is not cached for this account and collection access. Reconnect to load it.'}</p>}
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
    {(params.has('id')||params.has('recoveryOfEventId')) && <button type="button" className="mb-2 min-h-10 text-xs text-primary" onClick={()=>props.onOpenEvent?.('')}>Back to activity</button>}
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
      setSaved({page,syncedAt:value.syncedAt});setCached(false)
      writeActivityCache(localStorage,scope,key,page,value.syncedAt)
    }).catch(error=>{if(!cancelled)setError(error instanceof Error && error.name!=='AbortError' ? error.message : 'History request timed out. Refresh to try again.')})
      .finally(()=>{window.clearTimeout(timeout);if(!cancelled)setLoading(false)})
    return ()=>{cancelled=true;abort.abort();window.clearTimeout(timeout)}
  },[scope,pageQuery,isOnline,key,onInvalidScope])
  return <>
    {loading && <p role="status" className="py-2 text-xs">Loading activity…</p>}
    {error && <p role="alert" className="my-2 rounded-lg bg-destructive/10 p-3 text-sm">{error}</p>}
    {saved && (cached || !isOnline) && <p className="mb-3 text-xs text-muted-foreground">Saved activity · Last updated {activityTime(saved.syncedAt)}. Reconnect for the latest changes and Undo.</p>}
    {!saved && !loading && <p className="py-4">{!isOnline ? 'Connect to load this activity.' : 'Couldn’t load activity. Try Refresh.'}</p>}
    {saved?.page.data.length===0 && <p className="py-4">{cached || !isOnline ? 'No saved activity on this page. Reconnect to check for more.' : 'No activity matches these filters.'}</p>}
    <ol className="space-y-2" aria-label="Committed activity">{saved?.page.data.map((event,index)=>{
      const day=activityDay(event.recorded_at)
      return <ActivityEntry key={event.id} event={event} day={index===0 || day!==activityDay(saved.page.data[index-1].recorded_at) ? day : undefined} {...props} scope={scope} isOnline={isOnline} onInvalidScope={onInvalidScope}/>
    })}</ol>
    {saved?.page.nextCursor && <button type="button" className="mt-3 min-h-10 rounded-lg border border-border px-3" onClick={()=>onNext(saved.page.nextCursor!)}>Older page</button>}
  </>
}

function ActivityEntry({event,day,binders,collection,binderId,isOnline,pendingCount,onClose,onOpenPokemon,scope,onRecovered,onOpenEvent,onInvalidScope}:Props & {event:ActivityEvent;day?:string}) {
  const [expanded,setExpanded] = useState(false)
  const [count,setCount] = useState(10)
  const summary=activitySummary(event,binders)
  const changes=expanded ? readableActivityChanges(event) : []
  const first=event.changes[0]
  const state=first?.after ?? first?.before
  const liveCollections=binders.filter(b=>event.affected_entities.collectionIds?.includes(b.id))
  const pokemonId=event.pokemon_id ?? (typeof state?.pokemon_id==='number' ? state.pokemon_id : null)
  const liveItem=collection.find(item=>item.pokemon_id===pokemonId && (first?.id ? item.id===first.id : false))
  const person=activityActor(event,scope?.accountId,scope?.memberIds)
  return <li>
    {day && <h3 className="pt-3 pb-2 text-xs font-medium text-muted-foreground">{day}</h3>}
    <article className="rounded-xl border border-border/70 bg-background/50 p-3">
      <p className="text-sm font-medium leading-snug">{summary.title}</p>
      {summary.subtitle && <p className="mt-1 text-xs text-muted-foreground">{summary.subtitle}</p>}
      <p className="mt-1 text-xs text-muted-foreground">{person.startsWith('Account ') ? 'Previous member' : person} · <time dateTime={event.recorded_at}>{new Date(event.recorded_at).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</time></p>
      <div className="mt-1 flex flex-wrap items-start gap-x-1">
        <button type="button" aria-expanded={expanded} className="min-h-10 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted" onClick={()=>setExpanded(v=>!v)}>{expanded ? 'Hide details' : 'Details'}</button>
        {scope && <ActivityRecovery event={event} scope={scope} disabled={!isOnline||pendingCount>0} onRecovered={onRecovered} onOpenEvent={id=>onOpenEvent?.(id)} onInvalidScope={onInvalidScope}/>}
      </div>
      {expanded && <div className="mt-2 space-y-3 border-t border-border/60 pt-3 text-xs">
        {changes.slice(0,count).map((change,index)=><section key={index} className="rounded-lg bg-muted/40 p-3">
          {summary.count>1 && <h4 className="font-medium">{change.title}</h4>}
          {change.subtitle && summary.count>1 && <p className="mt-1 text-muted-foreground">{change.subtitle}</p>}
          {change.fields.length>0 ? <dl className="space-y-2">{change.fields.map(field=><div key={field.label}><dt className="text-muted-foreground">{field.label}</dt><dd className="mt-0.5">{field.before} <span className="px-1 text-muted-foreground" aria-label="changed to">→</span> {field.after}</dd></div>)}</dl> : summary.count===1 && <p className="text-muted-foreground">{change.title}</p>}
        </section>)}
        {changes.length>count && <button type="button" className="min-h-10 rounded-lg border border-border px-3" onClick={()=>setCount(c=>c+25)}>Show more changes ({changes.length-count} remaining)</button>}
        <button type="button" className="min-h-10 rounded-lg px-3 text-primary" onClick={()=>onOpenEvent?.(event.id,true)}>View undo history</button>
        {event.recovery_of_event_id && <button type="button" className="min-h-10 rounded-lg px-3 text-primary" onClick={()=>onOpenEvent?.(event.recovery_of_event_id!)}>View original change</button>}
        {isOnline && liveCollections.map(b=><OverlayLink key={b.id} href={`/?binder=${encodeURIComponent(b.id)}`} onClose={onClose} className="flex min-h-10 items-center rounded-lg px-3 text-primary">Open {b.name}</OverlayLink>)}
        {isOnline && liveItem && event.affected_entities.collectionIds?.includes(binderId ?? '') && <button type="button" className="min-h-10 rounded-lg px-3 text-primary" onClick={()=>{onClose();runAfterOverlayHistory(()=>onOpenPokemon(liveItem.pokemon_id))}}>Open card</button>}
        <details><summary className="min-h-10 cursor-pointer py-3 text-muted-foreground">Technical details</summary><div className="space-y-2 select-text text-muted-foreground">
          <p>Event {event.id} · {event.action}</p><p>{activitySource(event.source)} · {activityTime(event.recorded_at)}</p>
          <p>Account: {event.actor_user_id ?? 'Unknown'}</p>
          {event.operation_id && <p>Operation: {event.operation_id}</p>}{event.batch_id && <p>Batch: {event.batch_id}</p>}
          {event.client_id && <p>Client: {event.client_id}</p>}
          {event.format_version===0 && <p>Older entry with limited recorded information.</p>}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 text-[11px]">{JSON.stringify(activityChanges(event),null,2)}</pre>
        </div></details>
      </div>}
    </article>
  </li>
}
