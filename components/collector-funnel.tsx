'use client';
import { createContext, use, useCallback, useEffect, type ReactNode } from 'react';
import { appPath } from '@/lib/app-path';
import { sanitizeAttribution } from '@/lib/collector-funnel';

const Enabled = createContext(false);
const SOURCE_KEY = 'holofolder_funnel_source';
const inFlight = new Set<string>();
function captureSource() {
  try {
    const old = JSON.parse(sessionStorage.getItem(SOURCE_KEY) ?? 'null');
    if (old && typeof old.at === 'number' && Date.now() - old.at < 2 * 60 * 60_000) return;
    sessionStorage.removeItem(SOURCE_KEY);
    const params = new URLSearchParams(location.search);
    const attribution = sanitizeAttribution({
      source: params.get('utm_source'),
      medium: params.get('utm_medium'),
      campaign: params.get('utm_campaign'),
    });
    if (Object.values(attribution).some(Boolean))
      sessionStorage.setItem(SOURCE_KEY, JSON.stringify({ at: Date.now(), attribution }));
  } catch {
    /* Storage is optional. */
  }
}
export function CollectorFunnelProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  useEffect(() => {
    // oxlint-disable-next-line react-doctor/no-event-handler -- records the visit's source once tracking is enabled, not in response to a user event
    if (enabled) captureSource();
  }, [enabled]);
  return <Enabled.Provider value={enabled}>{children}</Enabled.Provider>;
}
export function useTrackCollectorEvent() {
  const enabled = use(Enabled);
  return useCallback(
    async (name: 'app_open' | 'upgrade_viewed', accountId: string | null) => {
      if (!enabled || !accountId || !navigator.onLine) return;
      const day = new Date().toISOString().slice(0, 10);
      const key = `holofolder_funnel:${accountId}:${name}:${day}`;
      if (inFlight.has(key)) return;
      try {
        if (sessionStorage.getItem(key)) return;
      } catch {
        /* Server deduplication still applies. */
      }
      inFlight.add(key);
      try {
        captureSource();
        let attribution = sanitizeAttribution(null);
        try {
          attribution = sanitizeAttribution(JSON.parse(sessionStorage.getItem(SOURCE_KEY) ?? 'null')?.attribution);
        } catch {
          /* Unknown source. */
        }
        const response = await fetch(appPath('/api/collector-events'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: name, attribution }),
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        const body = await response.json();
        if (response.ok && body.recorded === true) {
          try {
            sessionStorage.setItem(key, '1');
            sessionStorage.removeItem(SOURCE_KEY);
          } catch {
            /* Optional local suppression only. */
          }
        }
      } catch {
        /* Client observations are never queued alongside collection edits. */
      } finally {
        inFlight.delete(key);
      }
    },
    [enabled],
  );
}
export function useCollectorAppOpen(accountId: string | null, active: boolean) {
  const track = useTrackCollectorEvent();
  useEffect(() => {
    if (!active || !accountId) return;
    const open = () => {
      if (document.visibilityState === 'visible') void track('app_open', accountId);
    };
    open();
    window.addEventListener('online', open);
    document.addEventListener('visibilitychange', open);
    return () => {
      window.removeEventListener('online', open);
      document.removeEventListener('visibilitychange', open);
    };
  }, [accountId, active, track]);
}
