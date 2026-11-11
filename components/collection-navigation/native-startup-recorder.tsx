'use client';

import { useEffect } from 'react';
import { rememberNativeStartup } from '@/lib/collection/native-startup';
import type { InventoryReadScope } from '@/lib/collection/inventory-read-transport';

/** Small adapter at the checked host boundary. Session/queue owners remain unchanged. */
export default function NativeStartupRecorder({ scope }: { scope: InventoryReadScope }) {
  useEffect(() => {
    try {
      rememberNativeStartup(localStorage, scope);
    } catch {
      /* Unavailable storage cannot admit cached startup. */
    }
  }, [scope]);
  return null;
}
