'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'

const DeveloperApiKeys = dynamic(() => import('@/components/developer-settings').then(module => module.DeveloperApiKeys), {
  loading: () => <p className="text-sm text-muted-foreground">Loading API key management…</p>,
})
const AuthModal = dynamic(() => import('@/components/auth-modal'), { ssr: false })
function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => { window.removeEventListener('online', onChange); window.removeEventListener('offline', onChange) }
}

export function DocsApiKeys() {
  const [signingIn, setSigningIn] = useState(false)
  const isOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  const openSignIn = useCallback(() => setSigningIn(true), [])
  return <div className="not-prose">
    <section aria-label="API key management" className="not-prose my-6 space-y-4 rounded-2xl border border-fd-border bg-fd-card p-5">
      <div><h3 className="text-base font-semibold text-fd-foreground">Generate an API key</h3><p className="mt-1 text-sm leading-relaxed text-fd-muted-foreground">Use your Holo Folder account. Start with read access, and grant writes only when you need them.</p></div>
      <DeveloperApiKeys isOnline={isOnline} onSignIn={openSignIn} />
    </section>
    {signingIn && <div className="docs-key-auth"><AuthModal isOpen returnTo="/app/docs/api-keys#create-a-key" onClose={() => setSigningIn(false)} /></div>}
  </div>
}
