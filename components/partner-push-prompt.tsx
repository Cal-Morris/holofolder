'use client';

import { useEffect, useState } from 'react';
import { readPushMembership } from '@/lib/partner-push';

export function PartnerPushPrompt({ userId, onOpen }: { userId: string; onOpen(): void }) {
  const [visible, setVisible] = useState(false);
  // oxlint-disable-next-line react-doctor/no-fetch-in-effect -- one-shot client load with abort/cancel handling; the app has no data-fetching layer
  useEffect(() => {
    let active = true;
    const check = async () => {
      if (!('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'default') return;
      try {
        if (localStorage.getItem(`binderdex:push-prompt:${userId}`) || !readPushMembership(userId)) return;
        const response = await fetch('/app/api/push/subscriptions', {
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        if (active && response.ok && (await response.json()).configured) setVisible(true);
      } catch {
        /* A prompt is optional when the show has no signal. */
      }
    };
    void check();
    return () => {
      active = false;
    };
  }, [userId]);
  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(`binderdex:push-prompt:${userId}`, 'dismissed');
    } catch {
      /* Keep collecting if storage is full. */
    }
  };
  if (!visible) return null;
  return (
    <section
      aria-label="Partner updates at the show"
      className="border-border bg-muted/50 flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs"
    >
      <p className="min-w-0 flex-1">Hear when your partner finds a card. Enable notifications on this device.</p>
      <button
        type="button"
        className="border-border min-h-9 shrink-0 rounded-lg border px-2 font-semibold"
        onClick={() => {
          dismiss();
          onOpen();
        }}
      >
        Set up
      </button>
      <button type="button" className="min-h-9 shrink-0 rounded-lg px-2" onClick={dismiss}>
        Not now
      </button>
    </section>
  );
}
