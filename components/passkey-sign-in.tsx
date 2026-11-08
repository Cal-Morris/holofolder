'use client'

import { useEffect, useRef, useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePasskeySupport } from '@/hooks/use-passkey-support'
import { passkeyErrorMessage } from '@/lib/passkeys'

export function PasskeySignIn({ onSuccess, disabled = false }: { onSuccess: () => void; disabled?: boolean }) {
  const supported = usePasskeySupport()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    return () => controller.current?.abort()
  }, [])
  if (!supported) return null

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="min-h-12 w-full gap-2 rounded-xl" disabled={disabled || pending} onClick={async () => {
        if (pending) return
        setPending(true)
        setMessage('')
        controller.current = new AbortController()
        try {
          const { createClient } = await import('@/lib/supabase/client')
          const { error } = await createClient().auth.signInWithPasskey({ options: { signal: controller.current.signal } })
          if (error) throw error
          onSuccess()
        } catch (error) { setMessage(passkeyErrorMessage(error, 'sign-in')) }
        finally { setPending(false) }
      }}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        {pending ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
      </Button>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}
