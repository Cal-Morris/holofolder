'use client'

import { useEffect } from 'react'
import { reconcilePushAccount, syncPushShowMode } from '@/lib/push-device-client'

export function usePartnerPush(userId: string | null, enabled = true, showMode = false) {
  useEffect(() => {
    if (!enabled || !userId) return
    const controller = new AbortController()
    const sync = () => {
      if (navigator.onLine) void syncPushShowMode(showMode, controller.signal).catch(() => undefined)
    }
    sync()
    const refresh = () => { if (document.visibilityState === 'visible') sync() }
    const timer = showMode ? window.setInterval(refresh, 60_000) : undefined
    window.addEventListener('online', sync)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('online', sync)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [userId, enabled, showMode])

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
