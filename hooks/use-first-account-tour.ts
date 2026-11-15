'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  parseTourFlag,
  REPLAY_TOUR_EVENT,
  startingTourFlag,
  TOUR_METADATA,
  tourFlagAfterWizard,
  type TourFlag,
} from '@/lib/first-account-tour';

const storageKey = (accountId: string) => `holofolder-tour:${accountId}`;
const readLocal = (accountId: string) => {
  try {
    return parseTourFlag(localStorage.getItem(storageKey(accountId)));
  } catch {
    return null;
  }
};
const save = (accountId: string, flag: 'due' | 'done') => {
  try {
    localStorage.setItem(storageKey(accountId), flag);
  } catch {}
  // Best effort, like the wizard's flag: offline, this device still remembers.
  void createClient()
    .auth.updateUser({ data: { [TOUR_METADATA]: flag } })
    .catch(() => {});
};

/**
 * The first-account tour's state, kept like the first-binder wizard's (`use-binder-onboarding.ts`): the account's
 * metadata is the record and this device keeps a copy. Only accounts that open the wizard (`afterWizard`) become due,
 * so accounts from before the tour never see it unless they replay it from Settings.
 */
export function useFirstAccountTour(accountId: string) {
  const [flag, setFlag] = useState<TourFlag | undefined>(undefined);
  const [replaying, setReplaying] = useState(false);
  // oxlint-disable-next-line react-doctor/no-cascading-set-state -- each setState runs in its own callback (microtask, session read, replay event), never together.
  useEffect(() => {
    let live = true;
    const harness = location.pathname.includes('/e2e-harness');
    const asked = new URLSearchParams(location.search).has('tour');
    const local = readLocal(accountId);
    const known = startingTourFlag({ harness, asked, local, account: null });
    if (known || harness) {
      queueMicrotask(() => {
        if (live) setFlag(known);
      });
    } else {
      createClient()
        .auth.getSession()
        .then(({ data }) => {
          const user = data.session?.user;
          const account = user?.id === accountId ? parseTourFlag(user.user_metadata?.[TOUR_METADATA]) : null;
          if (account) {
            try {
              localStorage.setItem(storageKey(accountId), account);
            } catch {}
          }
          if (live) setFlag(account);
        })
        .catch(() => {
          if (live) setFlag(null);
        });
    }
    const replay = () => setReplaying(true);
    window.addEventListener(REPLAY_TOUR_EVENT, replay);
    return () => {
      live = false;
      window.removeEventListener(REPLAY_TOUR_EVENT, replay);
    };
  }, [accountId]);
  const afterWizard = useCallback(() => {
    const next = tourFlagAfterWizard(flag ?? readLocal(accountId));
    if (next === 'due' && flag !== 'due') save(accountId, 'due');
    setFlag(next);
  }, [accountId, flag]);
  const finish = useCallback(() => {
    if (flag !== 'done') save(accountId, 'done');
    setFlag('done');
    setReplaying(false);
  }, [accountId, flag]);
  return { open: flag === 'due' || replaying, afterWizard, finish };
}
