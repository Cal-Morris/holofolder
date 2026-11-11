'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { BinderSettings } from '@/lib/settings';
import { resolvePricingPreferences, type ResolvedPricingPreferences } from '@/lib/pricing-region';

function subscribe(onChange: () => void) {
  window.addEventListener('languagechange', onChange);
  return () => window.removeEventListener('languagechange', onChange);
}

function getLocaleSnapshot() {
  return navigator.languages?.length ? navigator.languages.join(',') : (navigator.language ?? '');
}

// The server cannot see the browser locale, so it renders the default region; the client
// re-renders with the real locale after hydration without a mismatch.
function getServerLocaleSnapshot() {
  return '';
}

/** The user's resolved pricing region, display currency and card language. */
export function usePricingPreferences(
  settings: Pick<BinderSettings, 'pricingRegion' | 'preferredCurrency' | 'preferredCardLanguage'>,
): ResolvedPricingPreferences {
  const localeSnapshot = useSyncExternalStore(subscribe, getLocaleSnapshot, getServerLocaleSnapshot);
  const { pricingRegion, preferredCurrency, preferredCardLanguage } = settings;

  return useMemo(
    () =>
      resolvePricingPreferences(
        { pricingRegion, preferredCurrency, preferredCardLanguage },
        localeSnapshot ? localeSnapshot.split(',') : null,
      ),
    [localeSnapshot, pricingRegion, preferredCurrency, preferredCardLanguage],
  );
}
