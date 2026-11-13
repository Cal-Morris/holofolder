// The picture scanner's two state machines, pure and without React or I/O: the matching worker's lifecycle
// (lib/card-picture-scanner.ts) and the "Download scanner for offline" switch (components/picture-scanner-prep.tsx).
import type { PictureScannerStatus } from '@/lib/card-picture-scanner';

/**
 * The worker that runs picture matches. Every start gets a new generation, so a start that finishes after the worker
 * was stopped (a download replaced the model mid-start) is recognised as stale and its worker is thrown away.
 * `unavailable` (not downloaded, or it failed to load) is kept until the next stop, which a download or removal
 * sends, so scans don't try to load it again each time.
 */
export type PictureWorkerLifecycle<W> =
  | { kind: 'stopped'; generation: number }
  | { kind: 'starting'; generation: number }
  | { kind: 'ready'; generation: number; worker: W }
  | { kind: 'unavailable'; generation: number };

export type PictureWorkerEvent<W> =
  | { type: 'start' }
  | { type: 'started'; generation: number; worker: W }
  | { type: 'failed'; generation: number }
  | { type: 'stop' };

export function pictureWorkerTransition<W>(
  state: PictureWorkerLifecycle<W>,
  event: PictureWorkerEvent<W>,
): PictureWorkerLifecycle<W> {
  switch (event.type) {
    case 'start':
      return state.kind === 'stopped' ? { kind: 'starting', generation: state.generation + 1 } : state;
    case 'started':
      return state.kind === 'starting' && state.generation === event.generation
        ? { kind: 'ready', generation: event.generation, worker: event.worker }
        : state;
    case 'failed':
      return state.kind === 'starting' && state.generation === event.generation
        ? { kind: 'unavailable', generation: state.generation }
        : state;
    case 'stop':
      return state.kind === 'stopped' ? state : { kind: 'stopped', generation: state.generation };
  }
}

/** A download in progress, wherever it was started (the switch, or the scanner warming it on first use online). */
export type PictureDownload = { kind: 'idle' } | { kind: 'downloading'; loaded: number; total: number };

/**
 * The switch. `bytes` is what the label shows: the download size while off, the size on the device while on (null
 * while a download that was already running is shown before the device has been checked).
 */
export type PicturePrepState =
  | { kind: 'checking'; message: string | null }
  | { kind: 'unsupported' }
  | { kind: 'off'; bytes: number; message: string | null }
  | { kind: 'downloading'; bytes: number | null; loaded: number; total: number }
  | { kind: 'on'; bytes: number; message: string | null }
  | { kind: 'removing'; bytes: number };

export type PicturePrepEvent =
  | { type: 'status'; status: PictureScannerStatus }
  | { type: 'status-failed' }
  /** The switch was turned on: start a download. */
  | { type: 'download' }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'download-ended' }
  | { type: 'download-failed'; message: string }
  /** The switch was turned off: remove the scanner. */
  | { type: 'remove' }
  | { type: 'removed' }
  | { type: 'remove-failed'; message: string };

export const CHECKING_PICTURE_PREP: PicturePrepState = { kind: 'checking', message: null };

const messageOf = (state: PicturePrepState) => ('message' in state ? state.message : null);

export function picturePrepTransition(state: PicturePrepState, event: PicturePrepEvent): PicturePrepState {
  switch (event.type) {
    case 'status':
      // A download or removal in flight decides what comes next; its end asks for a fresh status.
      if (state.kind === 'downloading' || state.kind === 'removing' || state.kind === 'unsupported') return state;
      return event.status.ready
        ? { kind: 'on', bytes: event.status.bytes, message: messageOf(state) }
        : { kind: 'off', bytes: event.status.bytes, message: messageOf(state) };
    case 'status-failed':
      return state.kind === 'checking' ? { kind: 'unsupported' } : state;
    case 'download':
      return state.kind === 'off' ? { kind: 'downloading', bytes: state.bytes, loaded: 0, total: state.bytes } : state;
    case 'progress':
      // Also from off or checking: a download the scanner started by itself shows here too, and blocks a second one.
      if (state.kind === 'downloading') return { ...state, loaded: event.loaded, total: event.total };
      if (state.kind === 'off' || state.kind === 'checking')
        return {
          kind: 'downloading',
          bytes: state.kind === 'off' ? state.bytes : null,
          loaded: event.loaded,
          total: event.total,
        };
      return state;
    case 'download-ended':
      return state.kind === 'downloading' ? CHECKING_PICTURE_PREP : state;
    case 'download-failed':
      // Arrives after download-ended, while the status is being checked again (or once it says off).
      if (state.kind === 'checking') return { kind: 'checking', message: event.message };
      if (state.kind === 'off') return { ...state, message: event.message };
      return state;
    case 'remove':
      return state.kind === 'on' ? { kind: 'removing', bytes: state.bytes } : state;
    case 'removed':
      return state.kind === 'removing' ? CHECKING_PICTURE_PREP : state;
    case 'remove-failed':
      return state.kind === 'removing' ? { kind: 'checking', message: event.message } : state;
  }
}

/** Which way the switch can be flipped now: on (download) only online, off (remove) any time; never mid-change. */
export function picturePrepAction(state: PicturePrepState, isOnline: boolean): 'download' | 'remove' | null {
  if (state.kind === 'on') return 'remove';
  if (state.kind === 'off' && isOnline) return 'download';
  return null;
}
