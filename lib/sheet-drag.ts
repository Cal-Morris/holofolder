/**
 * Framework-free maths for dragging bottom sheets: release velocity from recent pointer
 * samples, rubber-banding when dragged past the resting position, and the dismiss decision.
 * Kept separate from the hook so it can be unit tested.
 */
import { SWIPE_DISMISS_DISTANCE, SWIPE_DISMISS_VELOCITY } from './overlay-stack';

export interface DragSample {
  y: number;
  time: number;
}

/** Only the last stretch of the gesture counts towards release velocity. */
export const VELOCITY_WINDOW_MS = 80;
/** How far ahead (ms) the release velocity is projected when deciding to dismiss. */
export const PROJECTION_MS = 180;
/** Max distance (px) an upward drag can pull the sheet past its resting position. */
export const MAX_OVERDRAG = 18;

/** Downward release velocity in px/ms (positive = moving down), from samples ordered by time. */
export function releaseVelocity(samples: readonly DragSample[], now = samples.at(-1)?.time ?? 0): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  // A finger that stopped before lifting has no fling, however fast it moved earlier.
  if (now - last.time > VELOCITY_WINDOW_MS) return 0;
  let first = last;
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    if (last.time - samples[index].time > VELOCITY_WINDOW_MS) break;
    first = samples[index];
  }
  const elapsed = last.time - first.time;
  if (elapsed <= 0) return 0;
  return (last.y - first.y) / elapsed;
}

/** Sheet offset for a raw finger delta: 1:1 downwards, damped and capped upwards. */
export function dragOffset(deltaY: number): number {
  if (deltaY >= 0) return deltaY;
  const pull = -deltaY;
  return -MAX_OVERDRAG * (1 - 1 / (pull / (MAX_OVERDRAG * 2) + 1));
}

/** Recover the finger distance when catching an already rubber-banded sheet. */
export function dragDistanceForOffset(offset: number): number {
  return offset < 0 ? (2 * MAX_OVERDRAG * offset) / (MAX_OVERDRAG + offset) : offset;
}

/**
 * Dismiss on a long enough drag, a downward fling, or when the projected position
 * passes a third of the sheet. An upward fling at release always snaps back.
 */
export function shouldDismissDrag(deltaY: number, velocity: number, sheetHeight = 0): boolean {
  if (deltaY <= 0 || velocity < -0.15) return false;
  if (deltaY >= SWIPE_DISMISS_DISTANCE) return true;
  if (deltaY >= 24 && velocity >= SWIPE_DISMISS_VELOCITY) return true;
  if (sheetHeight > 0 && deltaY >= 24 && deltaY + Math.max(0, velocity) * PROJECTION_MS >= sheetHeight / 3) return true;
  return false;
}

/**
 * Decided once per touch on a sheet's body (not its grabber): a mostly-downward first move
 * while the body is scrolled to the top drags the sheet; anything else is a normal scroll.
 */
export function bodyMoveDragsSheet(dx: number, dy: number, scrollTop: number): boolean {
  return dy > 0 && dy >= Math.abs(dx) && scrollTop <= 0;
}

/** Exit duration (ms) so a fast fling finishes quickly and a slow release still glides. */
export function dismissDuration(remaining: number, velocity: number): number {
  const speed = Math.max(velocity, 1.2);
  return Math.round(Math.min(240, Math.max(120, remaining / speed)));
}
