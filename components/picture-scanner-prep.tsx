'use client';

import { useEffect, useState } from 'react';
import {
  downloadPictureScanner,
  getPictureScannerStatus,
  removePictureScanner,
  type PictureScannerStatus,
} from '@/lib/card-picture-scanner';

const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

/** Show mode's offline prep: the "Download scanner for offline" switch for the picture scanner. */
export default function PictureScannerPrep({ isOnline }: { isOnline: boolean }) {
  const [status, setStatus] = useState<PictureScannerStatus | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () =>
    getPictureScannerStatus().then(setStatus, () => setMessage('This browser can’t store the scanner.'));
  useEffect(() => {
    void refresh();
  }, []);

  const busy = progress !== null;
  const on = !!status?.ready;
  const toggle = async () => {
    if (busy) return;
    setMessage(null);
    if (on) {
      await removePictureScanner().catch(() => setMessage('Couldn’t remove the scanner. Try again.'));
      return void refresh();
    }
    setProgress({ loaded: 0, total: status?.bytes ?? 0 });
    try {
      await downloadPictureScanner((loaded, total) => setProgress({ loaded, total }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Download failed. Try again.');
    } finally {
      setProgress(null);
      void refresh();
    }
  };

  return (
    <section aria-label="Picture scanner" className="border-border mt-4 space-y-2 rounded-2xl border p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 id="picture-scanner-label" className="font-semibold">
            Download scanner for offline
          </h3>
          <p className="text-muted-foreground text-xs">
            Recognises cards by their picture, without a connection.{' '}
            {status &&
              (on ? `${megabytes(status.bytes)} on this device.` : `About ${megabytes(status.bytes)}, best on Wi-Fi.`)}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="picture-scanner-label"
          disabled={!status || busy || (!on && !isOnline)}
          onClick={() => void toggle()}
          className={`relative h-9 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on || busy ? 'bg-primary' : 'bg-muted'}`}
        >
          <span
            aria-hidden
            className={`bg-background absolute top-1 left-1 h-7 w-7 rounded-full shadow transition-transform ${on || busy ? 'translate-x-5' : ''}`}
          />
        </button>
      </div>
      {busy && (
        <div className="space-y-1">
          <progress
            aria-label="Scanner download"
            className="accent-primary h-2 w-full"
            value={progress.loaded}
            max={Math.max(progress.total, 1)}
          />
          <p role="status" className="text-xs">
            Downloading {megabytes(progress.loaded)} of {megabytes(progress.total)}…
          </p>
        </div>
      )}
      {!on && !busy && !isOnline && (
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
