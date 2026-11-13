'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OverlayDialog } from '@/components/ui/overlay-dialog';

/**
 * Asks what to do with a change the server turned down because the collection moved on. Closing it decides nothing:
 * the change stays queued and the session shows a line to reopen it.
 */
export default function ChangeConflictDialog({
  checked,
  canApplyAgain,
  onKeep,
  onApplyAgain,
  onCheck,
  onClose,
}: {
  /** The collection has been read since the rejection, so keep and apply again are safe to offer. */
  checked: boolean;
  canApplyAgain: boolean;
  onKeep: () => void;
  onApplyAgain: () => void;
  onCheck: () => void;
  onClose: () => void;
}) {
  return (
    <OverlayDialog
      variant="centred"
      onClose={onClose}
      aria-labelledby="change-conflict-title"
      className="bg-card/97 dark:border-border/50 overflow-y-auto px-4 pt-3 pb-4"
    >
      <div className="flex items-start justify-between gap-2 pb-1">
        <h2 id="change-conflict-title" className="pt-2 text-base font-semibold">
          Your last change wasn&apos;t applied
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Your collection changed before it was saved. What would you like to do?
      </p>
      <div className="flex flex-col gap-2">
        {checked ? (
          <>
            {canApplyAgain && (
              <Button size="lg" className="w-full" onClick={onApplyAgain}>
                Apply my change again
              </Button>
            )}
            <Button size="lg" variant={canApplyAgain ? 'outline' : 'default'} className="w-full" onClick={onKeep}>
              Keep my collection as it is
            </Button>
          </>
        ) : (
          <Button size="lg" className="w-full" onClick={onCheck}>
            Check my collection
          </Button>
        )}
      </div>
    </OverlayDialog>
  );
}
