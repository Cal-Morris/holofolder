import {Suspense} from 'react'
import type {Metadata} from 'next'
import OAuthConsent from '@/components/oauth-consent'
export const metadata:Metadata={title:'Authorize MCP access · Holo Folder',robots:{index:false,follow:false}}
export default function ConsentPage({searchParams}:{searchParams:Promise<{authorization_id?:string}>}) {
 return <main className="mx-auto min-h-dvh max-w-xl px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(32px,env(safe-area-inset-top))]">
  <a href="/app" className="inline-flex min-h-10 items-center font-semibold">Holo Folder</a>
  <h1 className="mt-8 text-2xl font-semibold tracking-tight">Connect your MCP client</h1>
  <Suspense fallback={<p className="mt-4 text-sm text-muted-foreground">Loading authorization request…</p>}><OAuthConsent searchParams={searchParams}/></Suspense>
 </main>
}
