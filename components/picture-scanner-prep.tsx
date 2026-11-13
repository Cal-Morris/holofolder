'use client';

import { useCallback, useEffect } from 'react';
import { useMachine } from '@/hooks/use-machine';
import {
  downloadPictureScanner,
  getPictureScannerStatus,
  removePictureScanner,
  subscribePictureDownload,
} from '@/lib/card-picture-scanner';
import { CHECKING_PICTURE_PREP, picturePrepAction, picturePrepTransition } from '@/lib/picture-scanner-state';

const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

/** Show mode's offline prep: the "Download scanner for offline" switch for the picture scanner. */
export default function PictureScannerPrep({ isOnline }: { isOnline: boolean }) {
  const [state, send] = useMachine(picturePrepTransition, CHECKING_PICTURE_PREP);
  const refresh = useCallback(
    () =>
      getPictureScannerStatus().then(
        (status) => send({ type: 'status', status }),
        () => send({ type: 'status-failed' }),
      ),
    [send],
  );
  useEffect(() => {
    void refresh();
    // Any download shows here, including one the scanner started by itself before this was opened.
    return subscribePictureDownload((download) => {
      if (download.kind === 'downloading') send({ type: 'progress', loaded: download.loaded, total: download.total });
      else if (send({ type: 'download-ended' })) void refresh();
    });
  }, [refresh, send]);

  const action = picturePrepAction(state, isOnline);
  const toggle = () => {
    if (action === 'remove' && send({ type: 'remove' }))
      void removePictureScanner()
        .then(
          () => send({ type: 'removed' }),
          () => send({ type: 'remove-failed', message: 'Couldn’t remove the scanner. Try again.' }),
        )
        .finally(refresh);
    else if (action === 'download' && send({ type: 'download' }))
      downloadPictureScanner().catch((error) =>
        send({
          type: 'download-failed',
          message: error instanceof Error ? error.message : 'Download failed. Try again.',
        }),
      );
  };

  const on = state.kind === 'on' || state.kind === 'removing';
  const lit = on || state.kind === 'downloading';
  const size = 'bytes' in state ? state.bytes : null;
  const message =
    state.kind === 'unsupported' ? 'This browser can’t store the scanner.' : 'message' in state ? state.message : null;
  return (
    <section aria-label="Picture scanner" className="border-border mt-4 space-y-2 rounded-2xl border p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 id="picture-scanner-label" className="font-semibold">
            Download scanner for offline
          </h3>
          <p className="text-muted-foreground text-xs">
            Recognises cards by their picture, without a connection.{' '}
            {size !== null && (on ? `${megabytes(size)} on this device.` : `About ${megabytes(size)}, best on Wi-Fi.`)}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="picture-scanner-label"
          disabled={!action}
          onClick={toggle}
          className={`relative h-9 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${lit ? 'bg-primary' : 'bg-muted'}`}
        >
          <span
            aria-hidden
            className={`bg-background absolute top-1 left-1 h-7 w-7 rounded-full shadow transition-transform ${lit ? 'translate-x-5' : ''}`}
          />
        </button>
      </div>
      {state.kind === 'downloading' && (
        <div className="space-y-1">
          <progress
            aria-label="Scanner download"
            className="accent-primary h-2 w-full"
            value={state.loaded}
            max={Math.max(state.total, 1)}
          />
          <p role="status" className="text-xs">
            Downloading {megabytes(state.loaded)} of {megabytes(state.total)}…
          </p>
        </div>
      )}
      {(state.kind === 'off' || state.kind === 'checking' || state.kind === 'unsupported') && !isOnline && (
        <p className="text-xs">Offline. Scanning reads the card’s name and number until the scanner is downloaded.</p>
      )}
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </section>
  );
}
