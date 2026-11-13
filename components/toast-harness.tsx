'use client';

// e2e only (/e2e-harness/toast): a toast fired from a modal and a non-modal sheet with an OverlayFooter.
import { useState } from 'react';
import { toast } from '@/components/ui/toast';
import { OverlayDialog, OverlayFooter } from '@/components/ui/overlay-dialog';

export default function ToastHarness() {
  const [open, setOpen] = useState<'modal' | 'non-modal' | null>(null);
  const [undone, setUndone] = useState(0);
  const close = () => setOpen(null);
  return (
    <main className="p-4">
      <h1>Toast harness</h1>
      <p aria-label="Undone count">{undone}</p>
      <button type="button" onClick={() => setOpen('modal')}>
        Open modal sheet
      </button>
      <button type="button" onClick={() => setOpen('non-modal')}>
        Open non-modal sheet
      </button>
      {open && (
        <OverlayDialog
          onClose={close}
          modal={open === 'modal'}
          aria-label={`${open} sheet`}
          layerClassName={open === 'modal' ? undefined : 'z-[60]'}
          backdropProps={{ className: 'bg-black/45' }}
          className="bg-card inset-x-0 bottom-0 mx-auto flex h-[100dvh] w-full max-w-md flex-col"
        >
          <div className="flex-1 p-4">Synthetic sheet</div>
          <OverlayFooter className="pb-[calc(var(--safe-bottom)+0.75rem)]">
            <button type="button" onClick={close} className="min-h-11 flex-1 rounded-xl border">
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                toast('Synthetic change saved', {
                  action: { label: 'Undo', onAction: () => setUndone((n) => n + 1) },
                })
              }
              className="holo-action min-h-11 flex-1 rounded-xl"
            >
              Save
            </button>
          </OverlayFooter>
        </OverlayDialog>
      )}
    </main>
  );
}
