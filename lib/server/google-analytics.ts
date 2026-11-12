import { after } from 'next/server';

export interface ApiRequestEvent {
  transport: 'rest' | 'mcp';
  operation: string;
  outcome: 'success' | 'failure';
  code?: string;
}

/** GA4 Measurement Protocol body. The credential id is hashed so GA counts integrations, never sees ids. */
export async function apiRequestPayload(credentialId: string, event: ApiRequestEvent) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credentialId));
  const clientId = Buffer.from(digest).toString('hex').slice(0, 32);
  return {
    client_id: clientId,
    events: [{ name: 'api_request', params: { ...event, code: event.code ?? 'ok', engagement_time_msec: 1 } }],
  };
}

/** Production only, sent after the response, never awaited by the caller and never throws. */
export function trackApiRequest(credentialId: string, event: ApiRequestEvent) {
  const measurementId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID,
    secret = process.env.GA_API_SECRET;
  if (process.env.VERCEL_ENV !== 'production' || !measurementId || !secret) return;
  const send = async () => {
    try {
      await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(secret)}`,
        {
          method: 'POST',
          body: JSON.stringify(await apiRequestPayload(credentialId, event)),
          signal: AbortSignal.timeout(3000),
        },
      );
    } catch {
      /* Analytics is best effort. */
    }
  };
  try {
    after(send);
  } catch {
    // No request lifecycle (scripts, tests): fire and forget.
    void send();
  }
}
