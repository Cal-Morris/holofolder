// The page scanner's session (components/native-page-scanner.tsx): aiming the camera, capturing and finding the
// pockets, reading each new card, then the review. Pure, no React. `start` is only accepted while aiming, so a double
// tap on Take photo, or a photo chosen while one is being read, can't start a second read over the first.

export type PageScanSession<Review> =
  | { kind: 'aiming'; problem: string | null }
  /** Encoding the photo and finding the filled pockets. */
  | { kind: 'capturing' }
  | { kind: 'reading'; done: number; total: number }
  | { kind: 'review'; review: Review };

export type PageScanEvent<Review> =
  | { type: 'start' }
  | { type: 'detected'; total: number }
  | { type: 'pocket-read' }
  | { type: 'reviewed'; review: Review }
  | { type: 'failed'; problem: string };

export const AIMING_PAGE_SCAN = { kind: 'aiming', problem: null } as const;

/** Returns the same state for an event that doesn't apply, so callers can tell it was turned away. */
export function pageScanTransition<Review>(
  state: PageScanSession<Review>,
  event: PageScanEvent<Review>,
): PageScanSession<Review> {
  switch (event.type) {
    case 'start':
      return state.kind === 'aiming' ? { kind: 'capturing' } : state;
    case 'detected':
      return state.kind === 'capturing' && event.total >= 0 ? { kind: 'reading', done: 0, total: event.total } : state;
    case 'pocket-read':
      return state.kind === 'reading' && state.done < state.total ? { ...state, done: state.done + 1 } : state;
    case 'reviewed':
      return state.kind === 'reading' ? { kind: 'review', review: event.review } : state;
    case 'failed':
      // Also from aiming: the page's scope can be refused before anything starts.
      return state.kind === 'review' ? state : { kind: 'aiming', problem: event.problem };
  }
}

export function pageScanStatus(state: PageScanSession<unknown>, cameraError: string | null) {
  if (state.kind === 'capturing' || (state.kind === 'reading' && !state.total)) return 'Reading the page…';
  if (state.kind === 'reading') return `Reading cards ${state.done} of ${state.total}…`;
  return cameraError ? "The camera isn't available. Choose a photo of the page instead." : '';
}
