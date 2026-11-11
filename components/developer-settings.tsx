'use client'
import { useEffect, useState } from 'react'
import DeveloperClients from '@/components/developer-clients'
import { appPath } from '@/lib/app-path'
import { Button } from '@/components/ui/button'
import { DEVELOPER_PERMISSION_LABELS, DEVELOPER_PERMISSIONS, DEFAULT_DEVELOPER_PERMISSIONS, normalizePermissions, type DeveloperPermission } from '@/lib/developer-api/permissions'
import type { DeveloperKeyMetadata } from '@/lib/developer-api/types'
import { Select } from "@/components/ui/select"
class DeveloperKeyRequestError extends Error {
 constructor(message:string,readonly status:number){super(message)}
}
const endpoint=appPath('/api/developer/keys')
async function requestKeys(method='GET',body?:unknown) {
 const response=await fetch(endpoint,{method,cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined})
 const result=await response.json()
 if(!response.ok) throw new DeveloperKeyRequestError(result.error?.message??'Developer access is temporarily unavailable.',response.status)
 return result
}
function keyRows(value:unknown):DeveloperKeyMetadata[] {
 if(!Array.isArray(value)) return []
 return value.flatMap(row=>{
  if(!row||typeof row!=='object'||typeof row.id!=='string'||typeof row.name!=='string'||typeof row.expires_at!=='string'||typeof row.created_at!=='string') return []
  try{return [{id:row.id,name:row.name,permissions:normalizePermissions(row.permissions),expires_at:row.expires_at,created_at:row.created_at,revoked_at:typeof row.revoked_at==='string'?row.revoked_at:null,last_used_at:typeof row.last_used_at==='string'?row.last_used_at:null}]}catch{return []}
 })
}
export function DeveloperApiKeys({isOnline,onSignIn}:{isOnline:boolean;onSignIn?:()=>void}) {
 const [signedOut,setSignedOut]=useState(false)
 const [keys,setKeys]=useState<DeveloperKeyMetadata[]>([]),[canCreate,setCanCreate]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
 const [error,setError]=useState(''),[name,setName]=useState(''),[expiry,setExpiry]=useState(90),[secret,setSecret]=useState('')
 const [permissions,setPermissions]=useState<DeveloperPermission[]>([...DEFAULT_DEVELOPER_PERMISSIONS])
 useEffect(()=>{
  let cancelled=false
  requestKeys().then(result=>{if(!cancelled){setKeys(keyRows(result.keys));setCanCreate(result.canCreate===true)}}).catch(error=>{if(!cancelled){if(error instanceof DeveloperKeyRequestError&&error.status===401&&onSignIn)setSignedOut(true);else setError(error instanceof Error?error.message:'Developer access unavailable.')}}).finally(()=>{if(!cancelled)setLoading(false)})
  return()=>{cancelled=true}
 },[onSignIn])
 async function change(method:string,body:unknown) {
  setBusy(true);setError('')
  try {
   const result=await requestKeys(method,body)
   if(typeof result.key==='string'){setSecret(result.key);setName('')}
   const updated=await requestKeys();setKeys(keyRows(updated.keys));setCanCreate(updated.canCreate===true)
  }catch(error){setError(error instanceof Error?error.message:'Try again shortly.')}
  finally{setBusy(false)}
 }
 if(signedOut&&onSignIn)return <div className="space-y-3"><p className="text-sm text-muted-foreground">Sign in to create and manage your API keys.</p><Button type="button" className="min-h-10" onClick={onSignIn}>Sign in to create a key</Button></div>
 return <div className="space-y-3">
  {loading?<p className="text-sm text-muted-foreground">Loading developer access…</p>:<>
   {!canCreate&&!error&&<p className="text-sm text-muted-foreground">Premium or lifetime access is required to create keys. You can still revoke existing keys.</p>}
   {secret&&<div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3"><p className="text-sm font-medium">API key created, copy it now. You won’t be able to view it again.</p><textarea aria-label="New API key" readOnly value={secret} rows={3} spellCheck={false} onFocus={event=>event.currentTarget.select()} onClick={event=>{const field=event.currentTarget;requestAnimationFrame(()=>field.select())}} className="block w-full resize-none select-text break-all rounded-lg border border-border bg-background p-2 font-mono text-base" /><div className="flex flex-wrap gap-2"><Button type="button" size="sm" className="min-h-9" onClick={()=>{navigator.clipboard.writeText(secret).catch(()=>setError('Could not copy. Select the key and copy it manually.'))}}>Copy key</Button><Button type="button" variant="outline" size="sm" className="min-h-9" onClick={()=>setSecret('')}>Hide key</Button></div></div>}
   {canCreate&&<form className="space-y-3" onSubmit={event=>{event.preventDefault();void change('POST',{name,expiryDays:expiry,permissions})}}>
    <label className="block text-sm">Key name<input value={name} maxLength={60} required onChange={event=>setName(event.target.value)} className="mt-1 w-full" placeholder="My collection script" autoComplete="off" /></label>
    <label className="block text-sm">Expires after<Select value={expiry} onChange={event=>setExpiry(Number(event.target.value))} className="mt-1 w-full">{[30,90,365].map(days=><option key={days} value={days}>{days} days</option>)}</Select></label>
    <details><summary className="flex min-h-9 cursor-pointer items-center text-sm">Permissions</summary><fieldset className="mt-2 space-y-1"><legend className="sr-only">API key permissions</legend>{DEVELOPER_PERMISSIONS.map(permission=><label key={permission} className="flex min-h-9 items-center gap-3 text-sm"><input type="checkbox" checked={permissions.includes(permission)} onChange={event=>setPermissions(current=>event.target.checked?[...current,permission]:current.filter(p=>p!==permission))} className="size-4"/><span className="break-all">{DEVELOPER_PERMISSION_LABELS[permission]}</span></label>)}</fieldset></details>
    <Button type="submit" className="min-h-10 w-full" disabled={busy||!isOnline||!name.trim()||Boolean(secret)}>{busy?'Saving…':'Create API key'}</Button>
   </form>}
   <div className="space-y-2">{keys.filter(key=>!key.revoked_at).map(key=><div key={key.id} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{key.name}</p><p className="mt-1 text-xs text-muted-foreground">Expires {new Date(key.expires_at).toLocaleDateString()}</p><p className="mt-1 text-xs text-muted-foreground">Key hidden. If you didn’t save it, revoke this key and create another.</p></div><Button type="button" variant="outline" size="sm" className="min-h-9 shrink-0" disabled={busy||!isOnline} onClick={()=>void change('DELETE',{id:key.id})} aria-label={`Revoke ${key.name}`}>Revoke</Button></div>)}</div>
  </>}
  {!isOnline&&<p className="text-xs text-muted-foreground">Connect to the internet to manage developer access.</p>}
  {error&&<p role="alert" className="break-words text-sm text-destructive">{error}</p>}
 </div>
}

export default function DeveloperSettings({isOnline}:{isOnline:boolean}) {
 return <section className="space-y-3" aria-label="Developer access">
  <div><p className="text-xs text-muted-foreground">API keys are for scripts. MCP clients connect through OAuth.</p><a href="https://holofolder.com/app/docs" className="inline-flex min-h-9 items-center text-sm text-primary">Read the developer docs</a></div>
  <DeveloperApiKeys isOnline={isOnline}/>
  <DeveloperClients isOnline={isOnline}/>
 </section>
}
