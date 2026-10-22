'use client'

import { useServiceWorkerRegistration } from '@/hooks/use-service-worker-registration'

export function ServiceWorkerRegistration() {
  useServiceWorkerRegistration()
  return null
}
