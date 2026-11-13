// The single-card scanner's session (components/quick-card-scanner.tsx): idle, reading frames, then looking the card
// up. Pure, no React. One scan runs at a time: `start` is only accepted while idle, so a double tap on Read card or a
// photo chosen while a read is running is turned away instead of starting a second read.
import type { CardScanOutcome, ScannedCardRead } from '@/lib/card-scan-identify';
import type { PictureScanDecision } from '@/lib/card-picture-match';
import { pictureMatchOutcome } from '@/lib/card-scan-search';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

export interface CardScanResult {
  outcome: CardScanOutcome;
  /** The text reader couldn't run (usually offline before it was ever downloaded). */
  readerUnavailable: boolean;
  offline: boolean;
  /** Native review candidates, absent from legacy callbacks. */
  candidates?: SearchCardResult[];
  /** Up to five cards the picture looked like, to tap when the read didn't settle it. */
  pictureChoices?: SearchCardResult[];
  /** `candidates[0]` is a confident picture match, pre-selected as a suggestion. */
  suggested?: boolean;
  /** The picture scanner isn't on this device yet, so only the text was read. */
  pictureUnavailable?: boolean;
}

export type CardScanSession =
  | { kind: 'idle'; problem: string | null }
  /** Reading frame `frame` of `frames` (3 from the camera, 1 from a chosen photo). */
  | { kind: 'reading'; frame: number; frames: number }
  | { kind: 'matching' };

export type CardScanEvent =
  | { type: 'start'; frames: number }
  | { type: 'frame'; frame: number }
  | { type: 'match' }
  | { type: 'done' }
  /** The scan's destination couldn't be captured as a read (or Type instead) began. */
  | { type: 'refused'; problem: string };

export const IDLE_CARD_SCAN: CardScanSession = { kind: 'idle', problem: null };

/** Returns the same state for an event that doesn't apply, so callers can tell it was turned away. */
export function cardScanTransition(state: CardScanSession, event: CardScanEvent): CardScanSession {
  switch (event.type) {
    case 'start':
      return state.kind === 'idle' && event.frames >= 1 ? { kind: 'reading', frame: 1, frames: event.frames } : state;
    case 'frame':
      return state.kind === 'reading' && event.frame > state.frame && event.frame <= state.frames
        ? { ...state, frame: event.frame }
        : state;
    case 'match':
      return state.kind === 'reading' ? { kind: 'matching' } : state;
    case 'refused':
      return state.kind === 'idle' || (state.kind === 'reading' && state.frame === 1)
        ? { kind: 'idle', problem: event.problem }
        : state;
    case 'done':
      return state.kind === 'idle' ? state : IDLE_CARD_SCAN;
  }
}

/** The status line under the camera. */
export function cardScanStatus(
  state: CardScanSession,
  { cameraReady, cameraError, isOnline, pictureReady }: CardScanStatusInput,
) {
  if (state.kind === 'reading') return `Reading the card… ${state.frame}/${state.frames}`;
  if (state.kind === 'matching') return isOnline ? 'Looking it up…' : 'Looking it up on this device…';
  if (state.problem) return state.problem;
  if (cameraError) return `${cameraError} Choose a photo of the card instead.`;
  if (!cameraReady) return '';
  return `${isOnline ? 'Hold steady, then tap Read card.' : 'Offline: reads the card and looks it up on this device.'}${
    pictureReady || isOnline ? '' : ' Picture scanner not downloaded, so only the name and number are read.'
  }`;
}

export interface CardScanStatusInput {
  cameraReady: boolean;
  cameraError: string | null;
  isOnline: boolean;
  pictureReady: boolean;
}

/**
 * Which way a scan settles the card. A picture match (on the device or the server, see `pictureRoute`) that the
 * decision rule turns into a card or a list of choices decides it; otherwise (no picture, or nothing to offer) the
 * text read is searched. Returns null for the text path.
 */
export function pictureScanResult(
  decision: PictureScanDecision,
  scanned: ScannedCardRead,
  { native, readerUnavailable, offline }: { native: boolean; readerUnavailable: boolean; offline: boolean },
): CardScanResult | null {
  // A confident picture opens like a clear match; in the binder review it is marked as a suggestion.
  if (decision.kind !== 'choose')
    return {
      outcome: pictureMatchOutcome(decision.card, scanned),
      ...(native
        ? decision.kind === 'suggest'
          ? { candidates: decision.candidates, suggested: true }
          : { candidates: [decision.card] }
        : {}),
      readerUnavailable,
      offline,
    };
  if (!decision.candidates.length) return null;
  const query = scanned.pokemon?.name ?? scanned.query;
  return {
    outcome: query ? { kind: 'choose', query } : { kind: 'unread', query },
    ...(native ? { candidates: decision.candidates } : {}),
    pictureChoices: decision.candidates,
    readerUnavailable,
    offline,
  };
}
