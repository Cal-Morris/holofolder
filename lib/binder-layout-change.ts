import { isBinderGridSize } from '@/lib/binder-layout';
import { parseSlotIntent } from '@/lib/collection/slot-optimistic';
import type { StagedSlotCommandIntent } from '@/lib/binder-slot-editing';
import type { OperationIntentContext } from '@/lib/domain/audit-context';
import type { InventorySnapshot } from '@/lib/domain/inventory';

export interface BinderGrid {
  rows: number;
  cols: number;
}
type PageRange = { first: number; last: number } | null;
/** What a grid change does to a binder whose pockets are an ordered list paged by rows × columns. */
export interface BinderLayoutChangePlan {
  from: BinderGrid;
  to: BinderGrid;
  changed: boolean;
  pockets: number;
  cards: number;
  pagesBefore: number;
  pagesAfter: number;
  /** Cards that land on a different page, with the pages they leave and the pages they land on. */
  cardsChangingPage: number;
  fromPages: PageRange;
  toPages: PageRange;
  /** Cards that stay on their page but sit in a different row or column. */
  cardsChangingSpot: number;
}

const pages = (pockets: number, grid: BinderGrid) => Math.ceil(pockets / (grid.rows * grid.cols));
const widen = (range: PageRange, page: number): PageRange =>
  range ? { first: Math.min(range.first, page), last: Math.max(range.last, page) } : { first: page, last: page };

/**
 * `filled[i]` is whether the pocket at position i holds a card. Pockets keep their order and nothing is removed,
 * so the only consequence is where each card shows: its page, row and column.
 */
export function planBinderLayoutChange(
  filled: readonly boolean[],
  from: BinderGrid,
  to: BinderGrid,
): BinderLayoutChangePlan {
  if (![from.rows, from.cols, to.rows, to.cols].every(isBinderGridSize)) throw new Error('invalid-binder-grid');
  const before = from.rows * from.cols,
    after = to.rows * to.cols;
  let cards = 0,
    cardsChangingPage = 0,
    cardsChangingSpot = 0,
    fromPages: PageRange = null,
    toPages: PageRange = null;
  filled.forEach((card, index) => {
    if (!card) return;
    cards++;
    const oldPage = Math.floor(index / before) + 1,
      newPage = Math.floor(index / after) + 1;
    if (oldPage !== newPage) {
      cardsChangingPage++;
      fromPages = widen(fromPages, oldPage);
      toPages = widen(toPages, newPage);
      return;
    }
    const oldOffset = index % before,
      newOffset = index % after;
    if (
      Math.floor(oldOffset / from.cols) !== Math.floor(newOffset / to.cols) ||
      oldOffset % from.cols !== newOffset % to.cols
    )
      cardsChangingSpot++;
  });
  return {
    from: { rows: from.rows, cols: from.cols },
    to: { rows: to.rows, cols: to.cols },
    changed: from.rows !== to.rows || from.cols !== to.cols,
    pockets: filled.length,
    cards,
    pagesBefore: pages(filled.length, from),
    pagesAfter: pages(filled.length, to),
    cardsChangingPage,
    fromPages,
    toPages,
    cardsChangingSpot,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pageSpan = (range: NonNullable<PageRange>) =>
  range.first === range.last ? `page ${range.first}` : `pages ${range.first}–${range.last}`;

/** Plain-language consequences, shared by the confirm sheet and the API dry run. */
export function describeBinderLayoutChange(plan: BinderLayoutChangePlan): string[] {
  if (!plan.changed) return ['This is already the binder’s layout. Nothing changes.'];
  const lines: string[] = [];
  if (plan.cardsChangingPage && plan.fromPages && plan.toPages)
    lines.push(
      `${plural(plan.cardsChangingPage, 'card')} on ${pageSpan(plan.fromPages)} will move to ${pageSpan(plan.toPages)}.`,
    );
  if (plan.cardsChangingSpot)
    lines.push(`${plural(plan.cardsChangingSpot, 'card')} will stay on the same page but sit in a different spot.`);
  if (!plan.cardsChangingPage && !plan.cardsChangingSpot)
    lines.push(
      plan.cards ? 'Every card stays on its page and in its spot.' : 'This binder has no cards in pockets yet.',
    );
  if (plan.pagesBefore !== plan.pagesAfter)
    lines.push(`The binder will have ${plural(plan.pagesAfter, 'page')} instead of ${plan.pagesBefore}.`);
  lines.push('No card leaves its pocket and nothing is removed. Pockets, cards and wants keep their order.');
  return lines;
}

/** One queued `layout` slot command for the binder in `scope`, bound to the revisions the user reviewed. */
export function prepareBinderLayoutIntent(
  snapshot: InventorySnapshot,
  scope: StagedSlotCommandIntent['scope'],
  grid: BinderGrid,
  context: OperationIntentContext,
): StagedSlotCommandIntent {
  const binder = snapshot.binders.find((b) => b.collectionId === scope.collectionId);
  const collection = snapshot.collections.find((c) => c.id === scope.collectionId);
  if (snapshot.ownerUserId !== scope.ownerUserId || !binder || !collection) throw new Error('layout-scope-changed');
  const intent = parseSlotIntent({
    kind: 'slots',
    context,
    request: {
      collectionId: collection.id,
      operationId: context.operationId,
      inventoryRevision: snapshot.inventoryRevision,
      collectionVersion: collection.version,
      layoutRevision: binder.layoutRevision,
      commands: [{ kind: 'layout', rows: grid.rows, cols: grid.cols }],
    },
  });
  return { scope: { ...scope, slotId: null }, intent };
}
