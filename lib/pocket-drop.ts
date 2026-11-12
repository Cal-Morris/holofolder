/**
 * What dropping one dragged pocket onto another does to the binder's slot order (components/binder/ordered-slot.tsx).
 *
 * - `place`: a quick drop. The two pockets swap; on an empty pocket that just puts the card there.
 * - `push`: the finger rested on a filled pocket first. The card takes that pocket and it, with the cards after it,
 *   shifts on by one into the next empty pocket; the pocket the card came from is left empty. With no empty pocket
 *   ahead, a new empty pocket is made where the card came from (`create`).
 *
 * Each change is a short list of single-pocket moves (`before: null` is the end), applied in order, never touching
 * a pocket twice: the slot command endpoint rejects a request that does.
 */
export interface PocketMove {
  id: string;
  before: string | null;
}
export type PocketDropMode = 'place' | 'push';
export interface PocketDropPlan {
  moves: PocketMove[];
  /** Make one empty pocket before this one first (push with nowhere to push to). */
  create?: { before: string };
}

export function planPocketDrop(
  slots: readonly { id: string; filled: boolean }[],
  from: string,
  to: string,
  mode: PocketDropMode,
): PocketDropPlan | null {
  const i = slots.findIndex((s) => s.id === from);
  const j = slots.findIndex((s) => s.id === to);
  if (i < 0 || j < 0 || i === j) return null;
  const after = (index: number) => slots[index + 1]?.id ?? null;
  if (mode === 'place' || !slots[j].filled) {
    // Neighbours swap with one move; otherwise the later pocket comes forward, then the earlier one takes its place.
    if (Math.abs(i - j) === 1) return { moves: [{ id: slots[Math.max(i, j)].id, before: slots[Math.min(i, j)].id }] };
    const [a, b] = i < j ? [i, j] : [j, i];
    return {
      moves: [
        { id: slots[b].id, before: slots[a].id },
        { id: slots[a].id, before: after(b) },
      ],
    };
  }
  // The first empty pocket from the target on; dragging backwards, the pocket it leaves counts as one.
  let k = j;
  while (k < slots.length && k !== i && slots[k].filled) k++;
  if (k === i) return { moves: [{ id: from, before: to }] };
  if (k === slots.length) return { moves: [{ id: from, before: to }], create: { before: from } };
  return {
    moves: [
      { id: slots[k].id, before: from },
      { id: from, before: to },
    ],
  };
}

/** One move on `order`, as the server applies it. */
function applyMove(order: readonly string[], move: PocketMove) {
  const next = order.filter((id) => id !== move.id);
  next.splice(move.before === null ? next.length : next.indexOf(move.before), 0, move.id);
  return next;
}

/** The order after `moves`, as the server applies them. */
export function applyPocketMoves(order: readonly string[], moves: readonly PocketMove[]) {
  return moves.reduce(applyMove, [...order]);
}

/** Where `id` goes back to: before whatever follows it in `order`. */
const backFor = (order: readonly string[], id: string): PocketMove => ({
  id,
  before: order[order.indexOf(id) + 1] ?? null,
});

/** The moves that undo `moves` made on `order`: each pocket goes back before whatever followed it, last move first. */
export function invertPocketMoves(order: readonly string[], moves: readonly PocketMove[]): PocketMove[] {
  const back: PocketMove[] = [];
  let state: readonly string[] = order;
  for (const move of moves) {
    back.unshift(backFor(state, move.id));
    state = applyMove(state, move);
  }
  return back;
}
