"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { History } from "lucide-react"
import { closeAllOverlays } from "@/hooks/use-overlay"
import { ACTIVITY_SCOPE_KEY, normalizeActivityScope, clearActivityCache, sameActivityScope, storedActivityScope, type ActivityScope } from "@/lib/collection-activity"
import type { NativeRecoveryBinding } from "@/components/native-activity-recovery"
import type { Binder } from "@/lib/binders/model"
import type { CollectedPokemon } from "@/lib/domain/cards"

const ActivitySheet = dynamic(()=>import("@/components/collection-activity-sheet"), {ssr:false})
export type ActivityInitialFilter = { pokemonId?: number; inventoryItemId?: string; operationId?: string }
const ActivityContext = createContext<((filter:ActivityInitialFilter)=>void) | null>(null)

/** Opens Collection Activity, or null where Activity is unavailable. */
export const useActivityOpener = () => useContext(ActivityContext)

export function ActivityButton({ pokemonId, onOpen, filter, label = "Activity" }: {pokemonId?:number; onOpen?:()=>void; filter?:ActivityInitialFilter; label?:string}) {
  const open = useContext(ActivityContext)
  if (!open) return null
  return <button type="button" className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted" onClick={()=>{onOpen?.();open(filter ?? {pokemonId})}}><History className="h-4 w-4" aria-hidden />{label}</button>
}

export function CollectionActivityProvider({accountId,ownerId,binderId,binders,collection,pendingCount,isOnline,onOpenPokemon,onRecovered,children,nativeRecovery}: {
  nativeRecovery?: NativeRecoveryBinding
  accountId:string|null; ownerId:string|null; binderId:string|null; binders:readonly Binder[]; collection:readonly CollectedPokemon[]
  pendingCount:number; isOnline:boolean; onOpenPokemon:(pokemonId:number)=>void; onRecovered:()=>Promise<void>; children:ReactNode
}) {
  const [scope,setScope] = useState<ActivityScope|null>(null)
  const [opened,setOpened] = useState<ActivityInitialFilter|null>(null)
  const [revision,setRevision] = useState(0)
  const close = useCallback(()=>setOpened(null),[])
  const invalidate = useCallback(()=>{clearActivityCache(localStorage);setScope(null);setOpened(null)},[])
  useEffect(()=>{
    let cancelled = false
    const abort = new AbortController()
    const stored = storedActivityScope(localStorage)
    if (!accountId || !ownerId || (stored && (stored.accountId!==accountId || stored.ownerId!==ownerId))) clearActivityCache(localStorage)
    if (!accountId || !ownerId) {void Promise.resolve().then(()=>{if(!cancelled)invalidate()});return ()=>{cancelled=true}}
    if (!opened) return
    if (!isOnline) {
      void Promise.resolve().then(()=>{if (!cancelled && stored?.accountId===accountId && stored.ownerId===ownerId) setScope(stored)})
      return ()=>{cancelled=true}
    }
    const timeout = window.setTimeout(()=>abort.abort(),8000)
    void fetch('/app/api/collection-activity?scope=1',{cache:'no-store',credentials:'same-origin',signal:abort.signal}).then(async response=>{
      if (!response.ok) { if (!cancelled) invalidate(); return }
      const value = await response.json()
      if (cancelled) return
      const next = normalizeActivityScope(value.scope)
      if (!next || next.accountId!==accountId || next.ownerId!==ownerId) {invalidate();return}
      if (!sameActivityScope(stored,next)) clearActivityCache(localStorage)
      try {localStorage.setItem(ACTIVITY_SCOPE_KEY,JSON.stringify(next))} catch { /* Online history still works without storage. */ }
      setScope(next)
    }).catch(()=>{ /* A failed verification never reveals a new cache scope. */ })
    return ()=>{cancelled=true;abort.abort();window.clearTimeout(timeout)}
  },[accountId,ownerId,isOnline,revision,invalidate,opened])
  useEffect(()=>{
    const refresh = ()=>{if (opened && document.visibilityState==='visible') setRevision(v=>v+1)}
    const storage = (event: StorageEvent)=>{if(event.key===ACTIVITY_SCOPE_KEY || event.key===null) {setScope(null);setOpened(null);setRevision(v=>v+1)}}
    window.addEventListener('focus',refresh)
    document.addEventListener('visibilitychange',refresh)
    window.addEventListener('storage',storage)
    const timer = window.setInterval(refresh,30_000)
    return ()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('storage',storage);window.clearInterval(timer)}
  },[opened])
  const verify = useCallback(()=>{setScope(null);setRevision(v=>v+1)},[])
  const allowed = !!accountId && !!ownerId
  const visibleScope = allowed && scope?.accountId===accountId && scope.ownerId===ownerId ? scope : null
  const open = useCallback((filter:ActivityInitialFilter)=>{closeAllOverlays();setScope(null);setOpened(filter);setRevision(v=>v+1)},[])
  return <ActivityContext.Provider value={allowed ? open : null}>
    {children}
    {opened && allowed && <ActivitySheet key={JSON.stringify([accountId,ownerId,opened])} scope={visibleScope} nativeRecovery={nativeRecovery} initialFilter={opened} binderId={binderId} binders={binders} collection={collection} pendingCount={pendingCount} isOnline={isOnline} onClose={close} onInvalidScope={invalidate} onVerify={verify} onOpenPokemon={onOpenPokemon} onRecovered={onRecovered} />}
  </ActivityContext.Provider>
}
