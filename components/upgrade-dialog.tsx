'use client';

import { BillingSettings } from '@/components/billing-settings';
import { OverlayCloseButton, OverlayDialog, OverlayGrabber } from '@/components/ui/overlay-dialog';

/** The small plan picker a blocked action (or the header's Upgrade) opens, instead of the whole Settings modal. */
export default function UpgradeDialog({
  signedIn,
  onClose,
  onSignIn,
}: {
  signedIn: boolean;
  onClose: () => void;
  onSignIn: () => void;
}) {
  return (
    <OverlayDialog
      onClose={onClose}
      aria-label="Upgrade to Premium"
      className="overflow-y-auto px-3 pt-2 pb-[calc(var(--safe-bottom)+0.75rem)]"
    >
      <div data-sheet-grabber className="relative">
        <OverlayGrabber />
        <OverlayCloseButton label="Close" onClick={onClose} className="absolute top-3 right-2 h-9 w-9" />
      </div>
      <BillingSettings signedIn={signedIn} onSignIn={onSignIn} className="border-0 p-1 pt-0" />
    </OverlayDialog>
  );
}
