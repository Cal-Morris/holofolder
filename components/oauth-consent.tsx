'use client'
import {use,useEffect,useState} from 'react'
import {Button} from '@/components/ui/button'
import {appPath} from '@/lib/app-path'
import {DEFAULT_DEVELOPER_PERMISSIONS,DEVELOPER_PERMISSION_LABELS,DEVELOPER_PERMISSIONS,type DeveloperPermission} from '@/lib/developer-api/permissions'
type Details={client:{id:string;name:string};redirectUri:string;scope:string;eligible:boolean}
export default function OAuthConsent({searchParams}:{searchParams:Promise<{authorization_id?:string}>}) {
 const {authorization_id:authorizationId}=use(searchParams)
 const [details,setDetails]=useState<Details|null>(null),[loading,setLoading]=useState(true),[signIn,setSignIn]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [permissions,setPermissions]=useState<DeveloperPermission[]>([...DEFAULT_DEVELOPER_PERMISSIONS])
 useEffect(()=>{
  let cancelled=false
  if(!authorizationId)return
  fetch(appPath(`/api/oauth/authorization?authorization_id=${encodeURIComponent(authorizationId)}`),{cache:'no-store'}).then(async response=>{
   const result=await response.json();if(cancelled)return
   if(response.status===401){setSignIn(true);return}
   if(!response.ok)throw new Error(result.error?.message??'This authorization request is unavailable.')
   if(typeof result.redirectUrl==='string'){window.location.assign(result.redirectUrl);return}
   if(typeof result.client?.name!=='string'||typeof result.client.id!=='string'||typeof result.redirectUri!=='string'||typeof result.scope!=='string')throw new Error('Invalid authorization details.')
   new URL(result.redirectUri)
   setDetails({client:result.client,redirectUri:result.redirectUri,scope:result.scope,eligible:result.eligible===true})
  }).catch(error=>{if(!cancelled)setError(error instanceof Error?error.message:'Authorization unavailable.')}).finally(()=>{if(!cancelled)setLoading(false)})
  return()=>{cancelled=true}
 },[authorizationId])
 async function decide(decision:'approve'|'deny') {
  if(!authorizationId)return
  setBusy(true);setError('')
  try {
   const response=await fetch(appPath('/api/oauth/decision'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({authorizationId,decision,permissions})})
   const result=await response.json()
   if(!response.ok||typeof result.redirectUrl!=='string')throw new Error(result.error?.message??'Authorization failed. Try connecting again.')
   window.location.assign(result.redirectUrl)
  }catch(error){setError(error instanceof Error?error.message:'Authorization failed.');setBusy(false)}
 }
 if(!authorizationId)return <p role="alert" className="mt-4 text-sm text-destructive">Start the connection from your MCP client to open a consent request.</p>
 if(signIn)return <div className="mt-6 space-y-4"><p className="text-sm text-muted-foreground">Sign in to review this client and choose its permissions.</p><a className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground" href={appPath(`/auth/login?next=${encodeURIComponent(appPath(`/oauth/consent?authorization_id=${authorizationId}`))}`)}>Sign in to Holo Folder</a></div>
 return <div className="mt-6 space-y-5">
  {loading&&<p className="text-sm text-muted-foreground">Loading authorization request…</p>}
  {details&&<>
   <div className="rounded-2xl border border-border bg-muted/20 p-4"><h2 className="break-words text-lg font-medium">{details.client.name}</h2><p className="mt-2 text-sm text-muted-foreground">This client wants to access your Holo Folder data.</p><p className="mt-3 break-all text-xs text-muted-foreground">Redirects to {new URL(details.redirectUri).host||new URL(details.redirectUri).protocol}</p>{details.scope&&<p className="mt-2 break-words text-xs text-muted-foreground">Account information requested: {details.scope.split(' ').join(', ')}</p>}</div>
   {!details.eligible&&<p className="rounded-xl border border-border p-4 text-sm">MCP access requires a Premium subscription or lifetime access. Signup trials do not include it. <a className="underline" href="/app">Open Holo Folder to manage your plan.</a></p>}
   <fieldset disabled={!details.eligible||busy} className="space-y-1"><legend className="mb-2 text-sm font-medium">Allow this client to</legend>{DEVELOPER_PERMISSIONS.map(permission=><label key={permission} className="flex min-h-10 items-center gap-3 rounded-lg px-2 text-sm"><input type="checkbox" className="size-4" checked={permissions.includes(permission)} onChange={event=>setPermissions(current=>event.target.checked?[...current,permission]:current.filter(p=>p!==permission))}/><span className="break-all">{DEVELOPER_PERMISSION_LABELS[permission]}</span></label>)}</fieldset>
   <p className="text-xs leading-relaxed text-muted-foreground">Write permissions allow this client to change your data. Sharing and partner permissions can change who has access. You can revoke the connection in Settings.</p>
   <div className="grid grid-cols-2 gap-3"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={()=>void decide('deny')}>Deny</Button><Button type="button" className="min-h-11" disabled={busy||!details.eligible} onClick={()=>void decide('approve')}>{busy?'Connecting…':'Approve access'}</Button></div>
  </>}
  {error&&<p role="alert" className="break-words text-sm text-destructive">{error}</p>}
 </div>
}
