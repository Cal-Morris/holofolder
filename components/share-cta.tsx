'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useCaptureCollectorSource } from '@/components/collector-funnel';
import { Button } from '@/components/ui/button';
import { PromptStrip } from '@/components/ui/prompt-strip';
import { SHARE_CTA_ATTRIBUTION } from '@/lib/collector-funnel';
import { createClient } from '@/lib/supabase/client';

const DISMISSED_KEY = 'holofolder:share-cta-dismissed';

/** Public share pages only: invites a signed-out viewer to start their own binder. Owners and other members never see it. */
export function ShareCta({ onStart }: { onStart(): void }) {
  const [visible, setVisible] = useState(false);
  const captureSource = useCaptureCollectorSource();
  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      /* Show it when storage is unavailable. */
    }
    let active = true;
    // The share page is cached for everyone, so the viewer is unknown to the server. getSession reads this device's
    // saved session without a request; hidden until it answers, so a signed-in owner never sees a flash.
    createClient()
      .auth.getSession()
      .then(
        ({ data }) => active && !data.session && setVisible(true),
        () => active && setVisible(true),
      );
    return () => {
      active = false;
    };
  }, []);
  if (!visible) return null;
  return (
    <PromptStrip
      label="Made with Holo Folder"
      message={
        <>
          <span className="font-semibold">Made with Holo Folder.</span> Start your own binder free.{' '}
          <span className="text-muted-foreground">The free plan has unlimited cards.</span>
        </>
      }
    >
      <Button
        type="button"
        size="sm"
        className="h-9 shrink-0"
        onClick={() => {
          captureSource(SHARE_CTA_ATTRIBUTION);
          onStart();
        }}
      >
        Start free
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Dismiss"
        className="-mr-1.5 shrink-0"
        onClick={() => {
          setVisible(false);
          try {
            localStorage.setItem(DISMISSED_KEY, '1');
          } catch {
            /* Dismissed for this visit only. */
          }
        }}
      >
        <X aria-hidden />
      </Button>
    </PromptStrip>
  );
}
