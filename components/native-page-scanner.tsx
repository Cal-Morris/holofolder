'use client';

import { useRef, useState, useEffect } from 'react';
import { Camera, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { useCameraStream } from '@/hooks/use-camera-stream';
import { scanBinderPageImage } from '@/lib/binder-page-scan';
import { drawVideoCoverFrame } from '@/lib/camera-frame';
import {
  captureScanDestination,
  mapScanCells,
  type ScanCell,
  type ScanDestinationAdmission,
  type ScanDestinationCapture,
} from '@/lib/scan-destinations';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import { identifyPocketCrop, type PocketRead } from '@/lib/card-scan-search';
import { warmCardTextReader } from '@/lib/card-scan-ocr';
import { getPictureScannerLanguages, matchCardPicture, warmPictureScanner } from '@/lib/card-picture-scanner';
import ScanDestinationReview, { type ScanReviewCell } from '@/components/scan-destination-review';
import CameraControls from '@/components/camera-controls';

export interface NativePageScanAdmission extends ScanDestinationAdmission {
  getOfflineCards: () => Promise<SearchCardResult[]>;
  /** Occupancy detector adapter. Default is the existing browser page detector. */
  detectPage?: (file: File, rows: number, cols: number) => Promise<ScanCell[]>;
  /** Pocket reader adapter for the e2e harness. Default reads the crop with identifyPocketCrop. */
  identifyPocket?: (crop: string) => Promise<PocketRead>;
}
const detectPage = async (file: File, rows: number, cols: number) =>
  (await scanBinderPageImage(file, rows, cols)).slots;
const pageProblem = (cause: unknown) =>
  cause instanceof Error && cause.message === 'scan-stale'
    ? 'This page changed while scanning. Close this and try again.'
    : "Couldn't read that photo. Try again with the whole page in view and good light.";

export default function NativePageScanner({
  admission,
  onClose,
}: {
  admission: NativePageScanAdmission;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const alive = useRef(true),
    saving = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [review, setReview] = useState<{ capture: ScanDestinationCapture; cells: ScanReviewCell[] } | null>(null);
  const camera = useCameraStream(!review, video);
  // Fetch the card text reader while the page is lined up, so reading the pockets doesn't wait on the download.
  useEffect(() => {
    void warmCardTextReader();
    warmPictureScanner();
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const close = () => {
    if (!saving.current) {
      alive.current = false;
      onClose();
    }
  };
  useOverlay(true, close, { containerRef: panel });
  const swipe = useSwipeToDismiss(panel, close, !review);
  const capture = async (file: File, captured: ScanDestinationCapture) => {
    setBusy(true);
    setError(null);
    setReading(null);
    try {
      const cells = mapScanCells(
        captured,
        await (admission.detectPage ?? detectPage)(file, captured.rows, captured.cols),
      );
      const filled = new Set(
        admission.snapshot.binders
          .find((b) => b.collectionId === captured.collectionId)
          ?.slots.flatMap((s) => (s.inventoryItemId ? [s.id] : [])),
      );
      // Read each new card's picture, name and number from its crop. Pockets already holding a card are left as they are.
      const toRead = cells.filter((c) => c.occupied && c.cardImageDataUrl && !(c.slotId && filled.has(c.slotId)));
      setReading({ done: 0, total: toRead.length });
      const reviewCells: ScanReviewCell[] = await Promise.all(
        cells.map(async (c) => {
          const crop = c.cardImageDataUrl;
          if (!crop || !toRead.includes(c)) return { ...c, candidates: [], crop };
          const found = await (admission.identifyPocket?.(crop) ??
            identifyPocketCrop(crop, admission.getOfflineCards, {
              matchPicture: matchCardPicture,
              collected: getPictureScannerLanguages(),
            }));
          if (alive.current) setReading((r) => r && { ...r, done: r.done + 1 });
          return { ...c, ...found, crop };
        }),
      );
      if (alive.current) setReview({ capture: captured, cells: reviewCells });
    } catch (cause) {
      if (alive.current) setError(pageProblem(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const cameraCapture = async () => {
    try {
      // Freeze scope/order BEFORE awaiting camera encoding or detection.
      const captured = captureScanDestination(admission.snapshot, admission.view);
      if (!video.current || !camera.ready || busy) return;
      setBusy(true);
      const canvas = document.createElement('canvas');
      canvas.width = video.current.videoWidth;
      canvas.height = video.current.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not capture page');
      drawVideoCoverFrame(video.current, context, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Could not encode page');
      if (alive.current) await capture(new File([blob], 'page-scan.jpg', { type: 'image/jpeg' }), captured);
    } catch (cause) {
      if (alive.current) {
        setError(pageProblem(cause));
        setBusy(false);
      }
    }
  };
  if (review)
    return (
      <ScanDestinationReview
        admission={admission}
        capture={review.capture}
        cells={review.cells}
        onClose={close}
        managed={{
          containerRef: panel,
          onBusyChange: (busy) => {
            saving.current = busy;
          },
        }}
      />
    );
  return (
    <div className="fixed inset-0 z-40">
      <div data-overlay-backdrop className="absolute inset-0 bg-black/55" onClick={close} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Scan page"
        className="absolute inset-x-2 bottom-[var(--dock-clearance)] mx-auto flex h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl bg-black p-3 text-white outline-none"
      >
        <header data-sheet-grabber {...swipe} className="relative flex shrink-0 items-center gap-2 pb-2">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/30"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-base leading-tight font-bold">Scan page</h2>
            <p className="text-xs text-white/65">
              Fit all {admission.view.rows} by {admission.view.cols} pockets in view. You choose each card before
              anything is added.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close page scanner"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-white/10 bg-black">
          <video ref={video} autoPlay playsInline muted className="h-full w-full object-cover" />
          {!camera.ready && !camera.error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Starting camera
              </span>
            </div>
          )}
          <CameraControls track={camera.track} />
        </div>
        <div className="shrink-0 space-y-2 pt-3">
          {error ? (
            <p role="alert" className="min-h-5 text-center text-sm text-red-300">
              {error}
            </p>
          ) : (
            <p role="status" className="min-h-5 text-center text-sm text-white/75">
              {busy
                ? reading?.total
                  ? `Reading cards ${reading.done} of ${reading.total}…`
                  : 'Reading the page…'
                : camera.error
                  ? "The camera isn't available. Choose a photo of the page instead."
                  : ''}
            </p>
          )}
          <div className="flex gap-2">
            <label className="flex h-14 shrink-0 cursor-pointer items-center gap-2 rounded-2xl border border-white/20 px-4 text-sm font-semibold has-[:disabled]:opacity-40">
              <ImageIcon className="h-4 w-4" aria-hidden />
              Choose photo
              <input
                aria-label="Page photo"
                type="file"
                accept="image/*"
                disabled={busy}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file || busy) return;
                  try {
                    void capture(file, captureScanDestination(admission.snapshot, admission.view));
                  } catch (cause) {
                    setError(pageProblem(cause));
                  }
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy || !camera.ready}
              onClick={() => void cameraCapture()}
              className="holo-action flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <Camera className="h-5 w-5" aria-hidden />
              )}
              Take photo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
