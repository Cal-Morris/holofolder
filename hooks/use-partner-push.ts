'use client'

import { useEffect } from 'react'
import { reconcilePushAccount } from '@/lib/push-device-client'

export function usePartnerPush(userId: string | null, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    const recover = async () => {
      await reconcilePushAccount(userId).catch(() => undefined)
      if (!stopped && userId && navigator.onLine && document.visibilityState === 'visible') {
        await fetch('/app/api/push/recover', { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => undefined)
      }
    }
    void recover()
    window.addEventListener('online', recover)
    document.addEventListener('visibilitychange', recover)
    return () => { stopped = true; window.removeEventListener('online', recover); document.removeEventListener('visibilitychange', recover) }
  }, [userId, enabled])
}
