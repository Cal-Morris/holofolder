'use client';

import { useEffect } from 'react';
import { registerServiceWorker } from '@/lib/service-worker-registration';

/** Registers the service worker after load, for public entry pages that don't render the binder. */
export function useServiceWorkerRegistration() {
  useEffect(() => registerServiceWorker({ whenIdle: true }), []);
}
