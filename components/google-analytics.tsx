'use client';

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { GoogleAnalytics } from '@next/third-parties/google';
import { sendGoogleEvent, setGoogleAnalyticsEnabled, type GoogleEvents } from '@/lib/google-analytics';

const AnalyticsEnabled = createContext(false);

export function GoogleAnalyticsProvider({
  enabled,
  gaId,
  children,
}: {
  enabled: boolean;
  gaId?: string;
  children: ReactNode;
}) {
  const active = enabled && Boolean(gaId);
  // Idempotent, and set during render so children's first effects already see it.
  setGoogleAnalyticsEnabled(active);
  return (
    <AnalyticsEnabled.Provider value={active}>
      {active && gaId && <GoogleAnalytics gaId={gaId} />}
      {children}
    </AnalyticsEnabled.Provider>
  );
}

export function useGoogleAnalytics() {
  const enabled = useContext(AnalyticsEnabled);
  return useCallback(
    <K extends keyof GoogleEvents>(name: K, parameters: GoogleEvents[K]) => {
      sendGoogleEvent(enabled, name, parameters);
    },
    [enabled],
  );
}
