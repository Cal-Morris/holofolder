'use client';

// Show mode's "Scan": point the camera at one card, read its name line and collector number, look the
// card up and hand back what was found (see lib/card-scan-identify.ts). Reading runs on the device
// (the system text reader where there is one, else Tesseract, whose engine is fetched from a CDN on first use);
// the lookup uses the card search online and the cards saved on this device offline. When it can't be
// sure, Quick mode gets the text it read so the search field can finish the job.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useMachine } from '@/hooks/use-machine';
import { Camera, ImageIcon, Keyboard, Loader2 } from 'lucide-react';
import { useOverlay } from '@/hooks/use-overlay';
import { useCameraStream } from '@/hooks/use-camera-stream';
import { SINGLE_CARD_GUIDE, captureSingleCardFrame, delay } from '@/lib/camera-frame';
import { mergeCardTextSignals, type CardTextSignals } from '@/lib/card-scan-text';
import { recognizeCardTextSignalsFromImage, warmCardTextReader } from '@/lib/card-scan-ocr';
import { trackGoogleEvent } from '@/lib/google-analytics';
import { decideScanOutcome, isScanReadComplete, readScannedCard } from '@/lib/card-scan-identify';
import { SCAN_REGIONS, lookupPokemon, resolvePictureCandidates, searchCards } from '@/lib/card-scan-search';
import {
  IDLE_CARD_SCAN,
  cardScanStatus,
  cardScanTransition,
  pictureScanResult,
  type CardScanResult,
} from '@/lib/card-scan-session';
import { confidentPicture, decidePictureScan } from '@/lib/card-picture-match';
import {
  getPictureScannerLanguages,
  getPictureScannerStatus,
  matchCardPicture,
  warmPictureScanner,
  type PictureScan,
} from '@/lib/card-picture-scanner';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

import {
  captureScanDestination,
  type ScanDestinationAdmission,
  type ScanDestinationCapture,
} from '@/lib/scan-destinations';
import ScanDestinationReview, { ScanSheet, type ScanReviewCell } from '@/components/scan-destination-review';
import { OverlayCloseButton } from '@/components/ui/overlay-dialog';
import CameraControls from '@/components/camera-controls';

const SCAN_FRAMES = 3;
const SCAN_FRAME_GAP_MS = 300;
/** A first read can include downloading the reader on show Wi-Fi; past this, fall back to typing. */
const SCAN_FRAME_TIMEOUT_MS = 20_000;
const destinationProblem = 'The scan destination changed. Close and reopen the scanner.';

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Reading the card took too long.')), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type { CardScanResult };

export interface QuickCardScannerProps {
  nativeAdmission?: ScanDestinationAdmission;
  onClose: () => void;
  onResult: (result: CardScanResult) => void;
  isOnline: boolean;
  getOfflineCards: () => Promise<SearchCardResult[]>;
}

export default function QuickCardScanner(props: QuickCardScannerProps) {
  if (props.nativeAdmission) return <NativeQuickCardScanner {...props} admission={props.nativeAdmission} />;
  return <QuickCardScannerCamera {...props} />;
}

function NativeQuickCardScanner({
  admission,
  ...props
}: QuickCardScannerProps & { admission: ScanDestinationAdmission }) {
  const captured = useRef<ScanDestinationCapture | null>(null);
  const alive = useRef(true),
    saving = useRef(false);
  const panel = useRef<HTMLDialogElement>(null);
  const [review, setReview] = useState<{ capture: ScanDestinationCapture; cells: ScanReviewCell[] } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const close = () => {
    if (!saving.current) {
      alive.current = false;
      props.onClose();
    }
  };
  useOverlay(true, close, { containerRef: panel, autoFocus: false });
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
    <QuickCardScannerCamera
      {...props}
      onClose={close}
      managedContainerRef={panel}
      onReadStarted={() => {
        captured.current = captureScanDestination(admission.snapshot, admission.view);
      }}
      onResult={(result) => {
        if (!alive.current) return;
        const capture = captured.current ?? captureScanDestination(admission.snapshot, admission.view);
        const candidates = result.candidates ?? (result.outcome.kind === 'match' ? [result.outcome.card] : []);
        setReview({
          capture,
          cells: [{ index: 0, slotId: null, occupied: true, candidates, suggested: result.suggested }],
        });
      }}
    />
  );
}

function QuickCardScannerCamera({
  onClose,
  onResult,
  isOnline,
  getOfflineCards,
  onReadStarted,
  managedContainerRef,
}: QuickCardScannerProps & { onReadStarted?: () => void; managedContainerRef?: RefObject<HTMLDialogElement | null> }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scan, send] = useMachine(cardScanTransition, IDLE_CARD_SCAN);
  const busy = scan.kind !== 'idle';
  const camera = useCameraStream(true, videoRef);
  const [pictureReady, setPictureReady] = useState(true);
  useEffect(() => {
    void getPictureScannerStatus().then(
      (status) => setPictureReady(status.ready),
      () => setPictureReady(false),
    );
  }, []);

  // Fetch the reader and the picture scanner while the card is lined up (and so they're kept for offline use).
  useEffect(() => {
    if (!isOnline) return;
    void warmCardTextReader();
    warmPictureScanner();
  }, [isOnline]);

  const closeSafely = useCallback(() => {
    if (!busy || onReadStarted) onClose();
  }, [busy, onClose, onReadStarted]);
  useOverlay(!managedContainerRef, closeSafely, { containerRef, autoFocus: false });

  /** Freezes the scan's destination as the read begins; false when it can't be. */
  const captureDestination = useCallback(() => {
    try {
      onReadStarted?.();
      return true;
    } catch {
      return false;
    }
  }, [onReadStarted]);

  const typeInstead = useCallback(() => {
    if (busy) return;
    if (!captureDestination()) return void send({ type: 'refused', problem: destinationProblem });
    if (onReadStarted) {
      void getOfflineCards()
        .catch(() => [])
        .then((candidates) =>
          onResult({
            outcome: { kind: 'unread', query: '' },
            readerUnavailable: false,
            offline: !isOnline,
            candidates,
          }),
        );
    } else onResult({ outcome: { kind: 'unread', query: '' }, readerUnavailable: false, offline: !isOnline });
  }, [busy, isOnline, onResult, onReadStarted, getOfflineCards, captureDestination, send]);

  /** Reads up to `count` frames from `nextFrame` (camera captures or one chosen photo), then looks the card up. */
  const readFrames = useCallback(
    async (count: number, nextFrame: (index: number) => Promise<string>) => {
      // Turned away while another read runs (a double tap, or a photo chosen mid-read).
      if (!send({ type: 'start', frames: count })) return;
      if (!captureDestination()) return void send({ type: 'refused', problem: destinationProblem });
      const frames: Array<CardTextSignals | null> = [];
      let readerFailures = 0;
      let picture: Promise<PictureScan | null> | null = null;
      try {
        for (let index = 0; index < count; index += 1) {
          send({ type: 'frame', frame: index + 1 });
          try {
            const image = await nextFrame(index);
            // The picture is matched once, on the first frame, in its own worker while the text is read.
            picture ??= matchCardPicture(image).catch(() => null);
            frames.push(
              await withTimeout(
                recognizeCardTextSignalsFromImage(image, {
                  regions: SCAN_REGIONS,
                  isEnough: isScanReadComplete,
                }),
                SCAN_FRAME_TIMEOUT_MS,
              ),
            );
          } catch (error) {
            readerFailures += 1;
            console.info('[holofolder] Card scan frame not read:', error);
          }
          if (isScanReadComplete(mergeCardTextSignals(frames))) break;
          if (index < count - 1) await delay(SCAN_FRAME_GAP_MS);
        }

        const scanned = readScannedCard(mergeCardTextSignals(frames));
        send({ type: 'match' });
        const pictured = picture ? await picture : null;
        const readerUnavailable = frames.length === 0 && readerFailures > 0;
        if (pictured?.matches.length) {
          const decision = decidePictureScan(
            await resolvePictureCandidates(pictured.matches, getPictureScannerLanguages(), getOfflineCards),
            scanned,
            confidentPicture(pictured.matches),
          );
          const offline = !isOnline;
          const result = pictureScanResult(decision, scanned, { native: !!onReadStarted, readerUnavailable, offline });
          if (result) {
            trackGoogleEvent('card_scanned', { outcome: decision.kind, offline });
            onResult(result);
            return;
          }
        }
        const { cards, offline } = await searchCards(scanned.query, isOnline, getOfflineCards, !!onReadStarted);
        const outcome = decideScanOutcome(cards, scanned, lookupPokemon);
        trackGoogleEvent('card_scanned', { outcome: outcome.kind, offline });
        onResult({
          outcome,
          ...(onReadStarted ? { candidates: cards } : {}),
          readerUnavailable,
          pictureUnavailable: !pictured,
          offline,
        });
      } catch (error) {
        console.info('[holofolder] Card scan failed:', error);
        onResult({
          outcome: { kind: 'unread', query: readScannedCard(mergeCardTextSignals(frames)).query },
          readerUnavailable: true,
          offline: !isOnline,
        });
      } finally {
        send({ type: 'done' });
      }
    },
    [getOfflineCards, isOnline, onResult, onReadStarted, captureDestination, send],
  );

  const read = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !camera.ready) return;
    await readFrames(SCAN_FRAMES, async (index) => (await captureSingleCardFrame(video, canvas, index)).previewUrl);
  }, [camera.ready, readFrames]);

  const readPhoto = useCallback(
    async (file: File) => {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await readFrames(1, async () => dataUrl);
    },
    [readFrames],
  );

  const body = (
    <>
      <canvas ref={canvasRef} className="hidden" />
      <div
        className={
          managedContainerRef
            ? 'mx-auto flex h-full w-full max-w-md flex-col p-3 text-white'
            : 'mx-auto flex h-full w-full max-w-md flex-col px-3 pt-[calc(var(--top-inset)+0.25rem)] pb-[calc(var(--safe-bottom)+0.75rem)] text-white'
        }
      >
        <div data-sheet-grabber className="flex shrink-0 touch-none items-center gap-2 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-base leading-tight font-bold">Scan a card</p>
            <p className="truncate text-xs text-white/65">Fill the frame with one card, name and number in view.</p>
          </div>
          <OverlayCloseButton
            label="Close scanner"
            onClick={closeSafely}
            disabled={busy && !onReadStarted}
            className="h-12 w-12 bg-white/10 hover:bg-white/10 disabled:opacity-40"
            iconClassName="h-5 w-5"
          />
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-white/10 bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
            data-testid="card-scan-video"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="rounded-[1.75rem] border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"
              style={{
                width: `${(1 - SINGLE_CARD_GUIDE.insetX * 2) * 100}%`,
                aspectRatio: `${SINGLE_CARD_GUIDE.aspectRatio}`,
                maxHeight: `${(1 - SINGLE_CARD_GUIDE.insetY * 2) * 100}%`,
              }}
            />
          </div>
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
          <p role="status" className="min-h-5 text-center text-sm text-white/75" data-testid="card-scan-status">
            {cardScanStatus(scan, {
              cameraReady: camera.ready,
              cameraError: camera.error,
              isOnline,
              pictureReady,
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={typeInstead}
              disabled={busy}
              className="flex h-14 shrink-0 items-center gap-2 rounded-2xl border border-white/20 px-4 text-sm font-semibold disabled:opacity-40"
            >
              <Keyboard className="h-4 w-4" aria-hidden />
              Type instead
            </button>
            <label className="flex h-14 shrink-0 cursor-pointer items-center gap-2 rounded-2xl border border-white/20 px-4 text-sm font-semibold has-[:disabled]:opacity-40">
              <ImageIcon className="h-4 w-4" aria-hidden />
              Photo
              <input
                aria-label="Card photo"
                type="file"
                accept="image/*"
                disabled={busy}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void readPhoto(file);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => void read()}
              disabled={!camera.ready || busy}
              className="holo-action flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <Camera className="h-5 w-5" aria-hidden />
              )}
              {busy ? 'Reading…' : 'Read card'}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  // Inside Quick mode (no review to follow) it is a full-screen layer of Quick mode's own.
  if (!managedContainerRef)
    return (
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Scan a card"
        className="fixed inset-0 z-[60] bg-black outline-none"
      >
        {body}
      </div>
    );
  return (
    <ScanSheet
      ref={managedContainerRef}
      managed
      onClose={closeSafely}
      aria-label="Scan a card"
      className="h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] bg-black"
    >
      {body}
    </ScanSheet>
  );
}
