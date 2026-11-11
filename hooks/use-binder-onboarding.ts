'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/** Supabase user metadata flag, so the first-binder wizard shows once per account rather than once per device. */
export const BINDER_ONBOARDING_METADATA = 'holofolder_binder_onboarding';
const storageKey = (accountId: string) => `holofolder-binder-onboarding:${accountId}`;
const readLocal = (accountId: string) => {
  try {
    return localStorage.getItem(storageKey(accountId)) === 'done';
  } catch {
    return false;
  }
};
const writeLocal = (accountId: string) => {
  try {
    localStorage.setItem(storageKey(accountId), 'done');
  } catch {}
};

/**
 * Whether this account has already seen (or skipped) the first-binder wizard. The account's metadata is the record;
 * this device keeps a copy so it also holds offline and before the session loads. Synthetic e2e pages only show it
 * when asked (`?onboarding=1`), so other specs keep their empty fixtures without a sheet in the way.
 */
export function useBinderOnboarding(accountId: string) {
  const [done, setDone] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    if (
      readLocal(accountId) ||
      (location.pathname.includes('/e2e-harness') && !new URLSearchParams(location.search).has('onboarding'))
    ) {
      queueMicrotask(() => {
        if (live) setDone(true);
      });
      return () => {
        live = false;
      };
    }
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        const user = data.session?.user;
        const seen = user?.id === accountId && user.user_metadata?.[BINDER_ONBOARDING_METADATA] === 'done';
        if (seen) writeLocal(accountId);
        if (live) setDone(seen);
      })
      .catch(() => {
        if (live) setDone(false);
      });
    return () => {
      live = false;
    };
  }, [accountId]);
  const finish = useCallback(() => {
    setDone(true);
    if (readLocal(accountId)) return;
    writeLocal(accountId);
    // Best effort: if this fails (offline), this device still remembers and another device shows it at most once.
    void createClient()
      .auth.updateUser({ data: { [BINDER_ONBOARDING_METADATA]: 'done' } })
      .catch(() => {});
  }, [accountId]);
  return { due: done === false, finish };
}
