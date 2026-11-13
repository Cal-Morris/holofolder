// The scan review's per-pocket choices (components/scan-destination-review.tsx), pure and without React. Each pocket
// is open (which card is this?), has a card chosen, or is skipped (remembering what to go back to on Include). The
// version, copy and pocket only exist once a card is chosen, and choosing another card clears them.
import type { CardFinish } from '@/lib/domain/cards';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

/** Most read candidates shown as tap-to-pick choices (lib/card-scan-search.ts offers at most this many). */
export const POCKET_CHOICE_LIMIT = 6;

export interface ReviewCellInput {
  index: number;
  occupied: boolean;
  candidates: SearchCardResult[];
  /** `candidates[0]` is a confident picture match, pre-selected as a suggestion. */
  suggested?: boolean;
}

type Open = { kind: 'open'; replace: boolean };
type Chosen = {
  kind: 'chosen';
  replace: boolean;
  card: SearchCardResult;
  finish?: CardFinish;
  /** 'raw' or `copy:<inventory item id>`. */
  copy?: string;
  /** `slot:<id>` or 'append'. */
  destination?: string;
};
/** `replace`: the pocket already holds a card and you chose to put this one there instead. A skipped pocket never replaces. */
export type PocketReview = Open | Chosen | { kind: 'skipped'; resume: Open | Chosen };

export interface ScanReviewState {
  pockets: Partial<Record<number, PocketReview>>;
  /** The pocket whose card picker is open. */
  picking: number | null;
  /** Pockets whose Change card goes back to their picture choices instead of opening the picker. */
  backToChoices: readonly number[];
}

export type ScanReviewEvent =
  /** A tap on one of the pocket's likely cards. */
  | { type: 'pick-choice'; index: number; card: SearchCardResult }
  /** Choose card: open the picker. */
  | { type: 'choose'; index: number }
  | { type: 'change'; index: number }
  | { type: 'picked'; index: number; card: SearchCardResult; finish?: CardFinish }
  | { type: 'close-picker' }
  | { type: 'finish'; index: number; finish: CardFinish }
  | { type: 'copy'; index: number; copy: string }
  | { type: 'destination'; index: number; destination: string | undefined }
  | { type: 'skip'; index: number }
  | { type: 'include'; index: number }
  /** Replace the card the binder already has here; `keepCard` keeps the scanned card when it differs. */
  | { type: 'replace'; index: number; keepCard: boolean }
  | { type: 'keep-current'; index: number };

/** A single clear match, or a confident picture suggestion, is offered as the card; anything less waits for you. */
export function initialScanReview(cells: readonly ReviewCellInput[]): ScanReviewState {
  const pockets: Partial<Record<number, PocketReview>> = {};
  const backToChoices: number[] = [];
  for (const cell of cells) {
    if (!cell.occupied) continue;
    const count = cell.candidates.length;
    const preselect = count === 1 || (cell.suggested && count > 0);
    pockets[cell.index] = preselect
      ? { kind: 'chosen', replace: false, card: cell.candidates[0] }
      : { kind: 'open', replace: false };
    // A photo suggestion goes back to its other picture matches first.
    if (cell.suggested && count > 1) backToChoices.push(cell.index);
  }
  return { pockets, picking: null, backToChoices };
}

const withPocket = (state: ScanReviewState, index: number, pocket: PocketReview): ScanReviewState => ({
  ...state,
  pockets: { ...state.pockets, [index]: pocket },
});

/** Returns the same state for an event that doesn't apply to the pocket as it is now. */
export function scanReviewTransition(state: ScanReviewState, event: ScanReviewEvent): ScanReviewState {
  if (event.type === 'close-picker') return state.picking === null ? state : { ...state, picking: null };
  const pocket = state.pockets[event.index];
  if (!pocket) return state;
  switch (event.type) {
    case 'pick-choice':
      return pocket.kind === 'open'
        ? withPocket(state, event.index, { kind: 'chosen', replace: pocket.replace, card: event.card })
        : state;
    case 'choose':
      return pocket.kind === 'open' && state.picking === null ? { ...state, picking: event.index } : state;
    case 'change':
      if (pocket.kind !== 'chosen' || state.picking !== null) return state;
      return state.backToChoices.includes(event.index)
        ? withPocket(state, event.index, { kind: 'open', replace: pocket.replace })
        : { ...state, picking: event.index };
    case 'picked':
      if (state.picking !== event.index || pocket.kind === 'skipped') return state;
      return {
        ...withPocket(state, event.index, {
          kind: 'chosen',
          replace: pocket.replace,
          card: event.card,
          ...(event.finish ? { finish: event.finish } : {}),
        }),
        picking: null,
      };
    case 'finish':
      return pocket.kind === 'chosen'
        ? withPocket(state, event.index, {
            kind: 'chosen',
            replace: pocket.replace,
            card: pocket.card,
            finish: event.finish,
          })
        : state;
    case 'copy':
      return pocket.kind === 'chosen' ? withPocket(state, event.index, { ...pocket, copy: event.copy }) : state;
    case 'destination':
      return pocket.kind === 'chosen'
        ? withPocket(state, event.index, { ...pocket, destination: event.destination })
        : state;
    case 'skip':
      return pocket.kind !== 'skipped'
        ? withPocket(state, event.index, { kind: 'skipped', resume: { ...pocket, replace: false } })
        : state;
    case 'include':
      return pocket.kind === 'skipped' ? withPocket(state, event.index, pocket.resume) : state;
    case 'replace':
      if (pocket.kind === 'skipped' || pocket.replace) return state;
      return withPocket(
        state,
        event.index,
        event.keepCard && pocket.kind === 'chosen' ? { ...pocket, replace: true } : { kind: 'open', replace: true },
      );
    case 'keep-current':
      return pocket.kind !== 'skipped' && pocket.replace
        ? withPocket(state, event.index, { ...pocket, replace: false })
        : state;
  }
}

/** The fields the review reads for a pocket, whatever its state. */
export function pocketChoice(pocket: PocketReview | undefined) {
  const current = pocket?.kind === 'skipped' ? pocket.resume : pocket;
  const chosen = current?.kind === 'chosen' ? current : undefined;
  return {
    card: chosen?.card,
    finish: chosen?.finish,
    copy: chosen?.copy,
    destination: chosen?.destination,
    skip: pocket?.kind === 'skipped',
    replace: !!current?.replace,
  };
}

/**
 * What the review says about a pocket: still `unread`, a few likely `choices` to tap, `photo` (a confident picture
 * pre-selected), `read` (the one clear match), `changed` (a card you picked), or `skipped`.
 */
export function pocketReviewStatus(cell: ReviewCellInput, pocket: PocketReview | undefined) {
  if (!pocket || pocket.kind === 'skipped') return 'skipped';
  if (pocket.kind === 'open')
    return cell.candidates.length > 1 && cell.candidates.length <= POCKET_CHOICE_LIMIT ? 'choices' : 'unread';
  if (pocket.card === cell.candidates[0] && cell.suggested) return 'photo';
  if (pocket.card === cell.candidates[0] && cell.candidates.length === 1) return 'read';
  return 'changed';
}
