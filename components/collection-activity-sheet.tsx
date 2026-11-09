"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss, runAfterOverlayHistory } from "@/hooks/use-overlay"
import { OverlayLink } from "@/components/overlay-link"
import { activityActor, activityEntityName, activityEntityKind, activityCacheKey, activityChanges, activitySource, activityTime, parseActivityPage, readActivityCache, sameActivityScope, writeActivityCache, type ActivityEvent, type ActivityScope } from "@/lib/collection-activity"
import type { ActivityInitialFilter } from "@/components/collection-activity-context"
import type { Binder } from "@/lib/binders/model"
import type { CollectedPokemon } from "@/lib/domain/cards"

interface Props {
  scope:ActivityScope|null; initialFilter:ActivityInitialFilter; binderId:string|null; binders:readonly Binder[]; collection:readonly CollectedPokemon[]
  pendingCount:number; isOnline:boolean; onClose:()=>void; onInvalidScope:()=>void; onVerify:()=>void; onOpenPokemon:(id:number)=>void
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
        <p className="text-xs text-muted-foreground">Committed shared history. Server time shown in your local timezone.</p>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 text-sm [overflow-wrap:anywhere]">
        <aside className="mb-3 rounded-xl bg-muted/60 p-3 text-xs">
          <p>{pendingCount ? `${pendingCount} locally pending edits on this device, not yet committed to shared history.` : 'No locally pending edits in this collection.'}</p>
          <p className="mt-1 text-muted-foreground">History does not restore changes. Recovery is not available.</p>
        </aside>
        <div className="mb-2 flex gap-2"><button type="button" className="min-h-10 rounded-lg border border-border px-3" aria-expanded={showFilters} onClick={()=>setShowFilters(v=>!v)}>Filters</button><button type="button" className="min-h-10 rounded-lg border border-border px-3" disabled={!isOnline} onClick={()=>{if(scope)setRevision(v=>v+1);else props.onVerify()}}>Refresh history</button></div>
        <p className="mb-2 text-xs text-muted-foreground">{selected.has('collectionId') ? `Collection: ${binders.find(b=>b.id===selected.get('collectionId'))?.name ?? selected.get('collectionId')}` : 'All collections'}{selected.has('pokemonId') ? ` · Pokémon #${selected.get('pokemonId')}` : ''}{selected.has('itemId') ? ` · Item ${selected.get('itemId')}` : ''}</p>
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
        {scope ? <ActivityResults key={`${filters}:${revision}`} {...props} scope={scope} query={filters} /> : <p role="status" className="py-4">{isOnline ? 'Verifying current collection access. If this does not load, use Refresh history to retry.' : 'History is not cached for this account and collection access. Reconnect to load it.'}</p>}
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
    <div className="mt-3 flex gap-2"><button type="button" className="min-h-10 rounded-lg border border-border px-3" disabled={!previous.length} onClick={()=>{setCursor(previous.at(-1) ?? null);setPrevious(v=>v.slice(0,-1))}}>Newer page</button></div>
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
    {loading && <p role="status" className="py-2 text-xs">Loading committed history…</p>}
    {error && <p role="alert" className="my-2 rounded-lg bg-destructive/10 p-3 text-sm">{error}</p>}
    {saved && <p className="mb-3 text-xs text-muted-foreground">{cached || !isOnline ? 'Cached history' : 'History synced'} · Last sync {activityTime(saved.syncedAt)}{cached || !isOnline ? '. Only saved pages are available; newer or uncached events may exist. Membership was last verified online.' : ''}</p>}
    {!saved && !loading && <p className="py-4">{!isOnline ? 'This history page is not cached on this device. Reconnect to load it.' : 'History has not loaded. Refresh to try again.'}</p>}
    {saved?.page.data.length===0 && <p className="py-4">{cached || !isOnline ? 'No entries in this cached page. Other events may exist.' : 'No recorded events match these filters.'}</p>}
    <ol className="space-y-3" aria-label="Committed activity">{saved?.page.data.map(event=><ActivityEntry key={event.id} event={event} {...props} scope={scope} isOnline={isOnline}/>)}</ol>
    {saved?.page.nextCursor && <button type="button" className="mt-3 min-h-10 rounded-lg border border-border px-3" onClick={()=>onNext(saved.page.nextCursor!)}>Older page</button>}
  </>
}

function ActivityEntry({event,binders,collection,binderId,isOnline,onClose,onOpenPokemon,scope}:Pick<Props,'binders'|'collection'|'binderId'|'isOnline'|'onClose'|'onOpenPokemon'|'scope'> & {event:ActivityEvent}) {
  const [expanded,setExpanded] = useState(false)
  const [count,setCount] = useState(10)
  const changes = expanded ? activityChanges(event) : []
  const first = event.changes[0]
  const state = first?.after ?? first?.before
  const name = activityEntityName(event)
  const liveCollections = binders.filter(b=>event.affected_entities.collectionIds?.includes(b.id))
  const pokemonId = event.pokemon_id ?? (typeof state?.pokemon_id==='number' ? state.pokemon_id : null)
  const liveItem = collection.find(item=>item.pokemon_id===pokemonId && (first?.id ? item.id===first.id : false))
  return <li className="rounded-xl border border-border bg-background/60 p-3">
    <p className="text-sm font-semibold">{event.action.replaceAll('_',' ')}{name ? ` · ${String(name)}` : ''}</p>
    <p className="mt-1 text-xs">{activityActor(event,scope?.accountId,scope?.memberIds)} · {activitySource(event.source)}</p>
    <time dateTime={event.recorded_at} className="text-xs text-muted-foreground">{activityTime(event.recorded_at)}</time>
    <p className="mt-1 text-xs text-muted-foreground">{event.changes.length || 1} recorded {event.changes.length<=1 ? 'change' : 'changes'} · Event {event.id}</p>
    <button type="button" aria-expanded={expanded} className="mt-2 min-h-10 rounded-lg border border-border px-3 text-xs font-medium" onClick={()=>setExpanded(v=>!v)}>{expanded ? 'Hide changes' : 'View changes'}</button>
    {expanded && <div className="mt-3 space-y-3 text-xs">
      <p>Recorded action: {event.action}</p>
      <p>Actor account: {event.actor_kind==='system' ? 'System' : event.actor_user_id ?? 'Unknown'}. Recorded identifiers are retained evidence, not a current profile name.</p>
      <p>Source: {activitySource(event.source)}{event.client_id ? ` · Client ${event.client_id}` : ''}</p>
      {event.operation_id && <p>Operation {event.operation_id}</p>}{event.batch_id && <p>Batch {event.batch_id}</p>}
      {event.client_occurred_at && <p>Client occurrence time (unverified): {activityTime(event.client_occurred_at)}</p>}
      {event.format_version===0 && <p>Older event: actor/source and stable entity IDs were not recorded. These are the original legacy states.</p>}
      {Object.entries(event.affected_entities).map(([kind,ids])=>ids.length>0 && <details key={kind}><summary className="min-h-9 cursor-pointer py-2">Retained {kind} ({ids.length})</summary><p className="select-text">{ids.join(', ')}</p></details>)}
      {changes.slice(0,count).map((change,index)=><section key={`${change.table}:${change.id}:${index}`} className="rounded-lg bg-muted/50 p-3">
        <h3 className="font-semibold">{change.title}</h3><p className="mt-1 text-muted-foreground">{activityEntityKind(change.table)} · {change.id || 'No stable ID recorded'}</p>
        <dl className="mt-2 space-y-2">{change.fields.map((field,i)=><div key={i}><dt className="font-medium">{field.label}</dt><dd><span className="text-muted-foreground">Before: </span>{field.before}</dd><dd><span className="text-muted-foreground">After: </span>{field.after}</dd></div>)}</dl>
      </section>)}
      {changes.length>count && <button type="button" className="min-h-10 rounded-lg border border-border px-3" onClick={()=>setCount(c=>c+25)}>Show more changes ({changes.length-count} remaining)</button>}
      {isOnline && liveCollections.map(b=><OverlayLink key={b.id} href={`/?binder=${encodeURIComponent(b.id)}`} onClose={onClose} className="flex min-h-10 items-center rounded-lg border border-border px-3">Open collection {b.name}</OverlayLink>)}
      {isOnline && liveItem && event.affected_entities.collectionIds?.includes(binderId ?? '') && <button type="button" className="min-h-10 rounded-lg border border-border px-3" onClick={()=>{onClose();runAfterOverlayHistory(()=>onOpenPokemon(liveItem.pokemon_id))}}>Open current item</button>}
      <p className="text-muted-foreground">Only currently available destinations can be opened. Removed entities retain their recorded information. No recovery command is available.</p>
    </div>}
  </li>
}
