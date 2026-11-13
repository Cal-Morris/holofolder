'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowLeftRight,
  ArrowLeftToLine,
  ArrowRightToLine,
  MoreHorizontal,
  PencilRuler,
  Plus,
  Redo2,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { InventoryCatalogResolver, InventorySnapshot } from '@/lib/domain/inventory';
import type { StagedSlotCommandIntent, SlotCommandSink } from '@/lib/binder-slot-editing';
import {
  captureBulkSelection,
  bulkSelectionState,
  prepareBulkLayoutIntent,
  preparePocketMoves,
  pageMove,
  type BulkSelection,
  type BulkLayoutAction,
} from '@/lib/binder-bulk-editing';
import { SLOT_LIMITS } from '@/lib/domain/slot-commands';
import { useSlotDraftAcceptance } from '@/hooks/use-slot-draft-acceptance';
import { useNativeSlotAction } from '@/hooks/use-native-slot-pick';
import { layoutFailureMessage } from '@/lib/slot-draft-failure';
import type { CardNamer } from '@/lib/pocket-labels';
import { cn } from '@/lib/utils';
import { invertPocketMoves, planPocketDrop, type PocketDropMode, type PocketMove } from '@/lib/pocket-drop';

const SlotRemovalReview = dynamic(() => import('@/components/binder/slot-removal-review'), { ssr: false });
const BulkFillReview = dynamic(() => import('@/components/binder/bulk-fill-review'), { ssr: false });
const PocketReserve = dynamic(() => import('@/components/binder/pocket-reserve'), { ssr: false });

export interface LayoutBoundary {
  snapshot: InventorySnapshot;
  scope: StagedSlotCommandIntent['scope'];
  catalog: InventoryCatalogResolver;
  onCommandIntent: SlotCommandSink;
  localDurable?: boolean;
  removal?: { available: boolean; receive: SlotCommandSink };
  bulkFill?: { available: boolean; receive: SlotCommandSink };
  /** Names and artwork for the cards in this read, so reviews show cards instead of IDs. */
  resolveCard?: CardNamer;
}

/**
 * How the binder grid talks to the bar while editing: a tapped pocket is a selection toggle or a move destination.
 * With `dropOn`, the pocket was dragged onto that pocket, whatever is selected: `place` swaps the two, `push` makes
 * room there (lib/pocket-drop.ts). A dragged selection lands together in the dropped-on pocket's place. Returns
 * whether a change was sent.
 */
export type LayoutTap = (slotId: string, dropOn?: string, mode?: PocketDropMode) => boolean;
export interface LayoutEditHost {
  rows: number;
  cols: number;
  /** The one-based page on screen, and how to show another, so a whole page can move. */
  page?: number;
  onPage?: (page: number) => void;
}
export interface LayoutSessionStart {
  ids: readonly string[];
  moving: boolean;
}

const button =
  'inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent';

/** A pointer must begin on this mounted control, and must not become a scroll or drag. */
function LayoutButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const press = useRef<{ x: number; y: number } | null>(null);
  return (
    <button
      {...props}
      type="button"
      className={cn(button, props.className)}
      onPointerDown={(event) => {
        press.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8)
          press.current = null;
      }}
      onPointerCancel={() => {
        press.current = null;
      }}
      onClick={(event) => {
        const deliberate = event.detail === 0 || press.current !== null;
        press.current = null;
        if (deliberate) props.onClick?.(event);
      }}
    />
  );
}

/** Menus and notices open over the binder, so the bar never grows and pushes it down. */
const popover =
  'border-border/70 bg-card text-foreground absolute inset-x-0 top-full z-40 mt-1 grid gap-0.5 rounded-2xl border p-1 shadow-xl sm:left-auto';
const notice =
  'border-border/70 bg-card flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 text-xs shadow-xl';

const menuItem =
  'flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-medium hover:bg-muted/70 disabled:opacity-45';

/**
 * Layout editing lives on the binder itself. Browsing shows one small control; editing shows one compact bar with
 * the count, the actions that apply and Done, while the pockets on the page are the selection.
 */
export function LayoutToolbar({
  editing,
  onToggle,
  boundary,
  host,
  start,
  onTap,
  onSelection,
}: {
  editing: boolean;
  onToggle: () => void;
  boundary: LayoutBoundary;
  host: LayoutEditHost;
  /** The bar hands the host its pocket-tap handler while it is mounted, and null when it leaves. */
  start?: LayoutSessionStart;
  onTap: (tap: LayoutTap | null) => void;
  onSelection: (ids: readonly string[], moving: boolean) => void;
}) {
  if (!editing)
    return (
      <section aria-label="Layout editing" className="flex shrink-0 justify-end">
        <LayoutButton
          aria-label="Edit layout"
          title="Edit layout"
          aria-pressed={false}
          onClick={onToggle}
          className="text-muted-foreground hover:bg-muted/60 h-9 w-9 rounded-lg border-0 p-0"
        >
          <PencilRuler className="h-4 w-4" aria-hidden />
        </LayoutButton>
      </section>
    );
  return (
    <LayoutBar
      boundary={boundary}
      host={host}
      start={start}
      onTap={onTap}
      onSelection={onSelection}
      onDone={onToggle}
    />
  );
}

/** One drop, arrow-key move or move to a spot: the single-pocket moves it made, and the ones that undo it. */
interface MoveStep {
  to: PocketMove[];
  back: PocketMove[];
}

function safeCapture(boundary: LayoutBoundary, ids: readonly string[]) {
  const binder = boundary.snapshot.binders.find((b) => b.collectionId === boundary.scope.collectionId);
  const live = new Set(binder?.slots.map((s) => s.id));
  return captureBulkSelection(
    boundary.snapshot,
    boundary.scope,
    [...new Set(ids)].filter((id) => live.has(id)).slice(0, SLOT_LIMITS.affected),
  );
}

/** Pick where the page on screen goes. Only full pages are offered. */
function PageMovePanel({
  from,
  pages,
  disabled,
  onMove,
}: {
  from: number;
  pages: number;
  disabled: boolean;
  onMove: (from: number, to: number) => void;
}) {
  const [to, setTo] = useState(from > 1 ? from - 1 : 2);
  return (
    <div role="group" aria-label="Move page" className={cn(popover, 'flex items-center gap-2 px-3 py-2 sm:w-80')}>
      <label htmlFor="layout-page-target" className="min-w-0 flex-1 text-sm font-medium">
        Move page {from} to page
      </label>
      <select
        id="layout-page-target"
        value={to}
        onChange={(event) => setTo(Number(event.target.value))}
        className="border-border bg-background h-9 rounded-lg border px-2 text-sm"
      >
        {Array.from({ length: pages - 1 }, (_, i) => (i + 1 < from ? i + 1 : i + 2)).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <LayoutButton
        disabled={disabled}
        onClick={() => onMove(from, to)}
        className="bg-primary text-primary-foreground hover:bg-primary/90 px-3"
      >
        Move
      </LayoutButton>
    </div>
  );
}

function LayoutBar({
  boundary,
  host,
  start,
  onTap,
  onSelection,
  onDone,
}: {
  boundary: LayoutBoundary;
  host: LayoutEditHost;
  start?: LayoutSessionStart;
  onTap: (tap: LayoutTap | null) => void;
  onSelection: (ids: readonly string[], moving: boolean) => void;
  onDone: () => void;
  // oxlint-disable-next-line react-doctor/prefer-useReducer -- independent layout editor controls; one reducer would not read better
}) {
  const { snapshot, scope, catalog } = boundary;
  const binder = snapshot.binders.find((b) => b.collectionId === scope.collectionId)!;
  const [selection, setSelection] = useState<BulkSelection>(() => safeCapture(boundary, start?.ids ?? []));
  const [moving, setMoving] = useState(() => Boolean(start?.moving && start.ids.length));
  const [menu, setMenu] = useState<'add' | 'more' | 'page' | null>(null);
  const [sheet, setSheet] = useState<'remove' | 'fill' | 'reserve' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prepared = useRef<ReturnType<typeof prepareBulkLayoutIntent> | null>(null);
  // This session's single-pocket moves, for Undo and Redo, and the one now being saved.
  const [steps, setSteps] = useState<{ done: MoveStep[]; undone: MoveStep[] }>({ done: [], undone: [] });
  const stepping = useRef<{ step: MoveStep; via: 'do' | 'undo' | 'redo' } | null>(null);
  // The snapshot the last accepted change was prepared on. Until a newer one arrives the view hasn't caught up,
  // and a change prepared now would be built on the collection as it was before that one.
  const preparedOn = useRef<InventorySnapshot | null>(null);
  const behind = useRef<InventorySnapshot | null>(null);
  const ids = selection.slots.map((s) => s.slot.id);
  let state: ReturnType<typeof bulkSelectionState> = 'selection-changed';
  try {
    state = bulkSelectionState(snapshot, scope, selection);
  } catch {
    /* A changed owner or collection ends this selection. */
  }
  const { pending, busy, message, handoff, discard } = useSlotDraftAcceptance<StagedSlotCommandIntent>(
    boundary.onCommandIntent,
    () => {
      const accepted = prepared.current;
      if (accepted) setSelection(captureBulkSelection(accepted.preview, scope, ids));
      behind.current = preparedOn.current;
      const done = stepping.current;
      stepping.current = null;
      // Group moves and inserts can't be undone as one step, so earlier steps would no longer read true.
      if (!done) setSteps({ done: [], undone: [] });
      else
        setSteps(({ done: past, undone }) =>
          done.via === 'undo'
            ? { done: past.slice(0, -1), undone: [...undone, done.step] }
            : done.via === 'redo'
              ? { done: [...past, done.step], undone: undone.slice(0, -1) }
              : { done: [...past, done.step], undone: [] },
        );
      setMoving(false);
      setError(null);
    },
  );
  const blocked = busy || pending !== null || behind.current === snapshot;
  const unavailable = blocked || state !== 'current';
  // The pocket stays selected across its own change, on the collection as it now is.
  const keepSelection = (preview?: InventorySnapshot) => {
    if (preview) {
      try {
        setSelection(captureBulkSelection(preview, scope, ids));
      } catch {
        /* The next read settles it. */
      }
    }
    setError(null);
  };
  const single = ids.length === 1 ? binder.slots.find((s) => s.id === ids[0]) : undefined;
  const pocket = useNativeSlotAction(
    single
      ? { snapshot, scope: { ...scope, slotId: single.id }, catalog, onCommandIntent: boundary.onCommandIntent }
      : undefined,
    (preview) => keepSelection(preview),
  );
  const select = (next: readonly string[]) => {
    try {
      setSelection(captureBulkSelection(snapshot, scope, next));
      setError(null);
    } catch {
      setError(`You can select up to ${SLOT_LIMITS.affected} pockets at once.`);
    }
  };
  // A group move or an insert: these clear the Undo history.
  const emit = (action: BulkLayoutAction, moved = selection) => {
    if (unavailable) return false;
    setMenu(null);
    stepping.current = null;
    try {
      preparedOn.current = snapshot;
      prepared.current = prepareBulkLayoutIntent(
        snapshot,
        scope,
        moved,
        action,
        {
          source: 'app',
          clientId: null,
          operationId: crypto.randomUUID(),
          batchId: null,
          clientOccurredAt: new Date().toISOString(),
        },
        catalog,
      );
      handoff({ scope: prepared.current.scope, intent: prepared.current.intent });
      return true;
    } catch (cause) {
      stepping.current = null;
      setError(layoutFailureMessage(cause));
      return false;
    }
  };
  const movePage = (from: number, to: number) => {
    try {
      const { ids: pageIds, destination } = pageMove(snapshot, scope, from, to, host.rows, host.cols);
      if (emit({ kind: 'move', destination }, captureBulkSelection(snapshot, scope, pageIds))) host.onPage?.(to);
    } catch (cause) {
      setError(layoutFailureMessage(cause));
    }
  };
  // Single-pocket moves, whatever is selected: a drop, an arrow-key move, an Undo or a Redo. A drop that leaves a new
  // empty pocket behind (`create`) can't be undone as one step, so it clears the history like an insert.
  const moveOne = (step: MoveStep, via: 'do' | 'undo' | 'redo', create?: { before: string }) => {
    if (blocked) {
      if (behind.current === snapshot) setError('Still placing the last move. Try again in a moment.');
      return false;
    }
    setMenu(null);
    stepping.current = create ? null : { step, via };
    try {
      preparedOn.current = snapshot;
      prepared.current = preparePocketMoves(
        snapshot,
        scope,
        via === 'undo' ? step.back : step.to,
        {
          source: 'app',
          clientId: null,
          operationId: crypto.randomUUID(),
          batchId: null,
          clientOccurredAt: new Date().toISOString(),
        },
        catalog,
        create ? { id: crypto.randomUUID(), before: create.before } : undefined,
      );
      handoff({ scope: prepared.current.scope, intent: prepared.current.intent });
      return true;
    } catch (cause) {
      stepping.current = null;
      setError(layoutFailureMessage(cause));
      return false;
    }
  };
  const undo = () => {
    const step = steps.done.at(-1);
    if (step) moveOne(step, 'undo');
  };
  const redo = () => {
    const step = steps.undone.at(-1);
    if (step) moveOne(step, 'redo');
  };
  const insert = (amount: number, destination: BulkLayoutAction['destination']) =>
    emit({ kind: 'insert', ids: Array.from({ length: amount }, () => crypto.randomUUID()), destination });
  const tap = (slotId: string, dropOn?: string, mode: PocketDropMode = 'place') => {
    if (dropOn) {
      const from = binder.slots.findIndex((s) => s.id === slotId);
      const to = binder.slots.findIndex((s) => s.id === dropOn);
      if (from < 0 || to < 0 || from === to) return false;
      // A selected pocket carries the whole selection with it, landing in the same place a single one would.
      if (ids.length > 1 && ids.includes(slotId)) {
        if (ids.includes(dropOn)) return false;
        if (blocked || state !== 'current') {
          setError(
            state !== 'current'
              ? 'These pockets changed. Update the selection to carry on.'
              : 'Still placing the last move. Try again in a moment.',
          );
          return false;
        }
        emit({ kind: 'move', destination: { kind: from < to ? 'after' : 'before', slotId: dropOn } });
        return true;
      }
      const order = binder.slots.map((s) => ({ id: s.id, filled: s.inventoryItemId !== null }));
      const plan = planPocketDrop(order, slotId, dropOn, mode);
      if (!plan) return false;
      return moveOne(
        {
          to: plan.moves,
          back: invertPocketMoves(
            order.map((s) => s.id),
            plan.moves,
          ),
        },
        'do',
        plan.create,
      );
    }
    if (blocked) return false;
    if (state !== 'current') {
      setError('These pockets changed. Update the selection to carry on.');
      return false;
    }
    if (!moving) {
      select(ids.includes(slotId) ? ids.filter((id) => id !== slotId) : [...ids, slotId]);
      return false;
    }
    if (ids.includes(slotId)) {
      setError("Tap a pocket that isn't selected.");
      return false;
    }
    emit({ kind: 'move', destination: { kind: 'before', slotId } });
    return true;
  };
  useLayoutEffect(() => {
    onTap(tap);
    return () => onTap(null);
  });
  const shortcuts = useRef({ undo, redo });
  useLayoutEffect(() => {
    shortcuts.current = { undo, redo };
  });
  // Cmd/Ctrl+Z undoes the last move while editing; Shift+Cmd+Z or Ctrl+Y redoes it. Text fields keep their own.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!(event.metaKey || event.ctrlKey) || target?.closest('input, textarea, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) shortcuts.current.undo();
      else if ((key === 'z' && event.shiftKey) || key === 'y') shortcuts.current.redo();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const selectionKey = ids.join(',');
  // The grid draws the selection; it only needs the IDs and whether a tap now picks a destination.
  useLayoutEffect(() => {
    // oxlint-disable-next-line react-doctor/no-prop-callback-in-effect -- reports the selection for the grid to draw; it changes from many handlers
    onSelection(ids, moving);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, moving]);
  const ordered = binder.slots.filter((s) => ids.includes(s.id));
  const first = ordered[0]?.id,
    last = ordered[ordered.length - 1]?.id;
  const page = host.rows * host.cols;
  const fullPages = Math.floor(binder.slots.length / page);
  // The page on screen can move when it and at least one other page are full.
  const pageToMove = host.page && host.onPage && host.page <= fullPages && fullPages > 1 ? host.page : null;
  const count = ids.length === 0 ? 'Tap pockets to select' : `${ids.length} selected`;
  const failure = error ?? (pending ? message : null) ?? pocket.failed;
  return (
    <section
      aria-label="Layout editing"
      data-layout-bar
      className="text-foreground relative z-30 w-full min-w-0 shrink-0"
    >
      {/* One row, the same height as the toolbar it replaces, so the binder doesn't move. Below 640px the actions
          are icons with their names as labels, and the count is read out rather than shown. */}
      <div className="flex min-h-9 items-center gap-0.5 sm:gap-1">
        <p
          role="status"
          className={cn('min-w-0 flex-1 truncate px-1.5 text-sm font-semibold', !moving && 'max-sm:sr-only')}
        >
          {moving ? `Tap where ${ids.length === 1 ? 'it goes' : 'they go'}` : count}
        </p>
        {!moving && <span aria-hidden className="flex-1 sm:hidden" />}
        {moving ? (
          <>
            <LayoutButton
              aria-label="To the start"
              title="To the start"
              disabled={unavailable}
              onClick={() => emit({ kind: 'move', destination: { kind: 'beginning' } })}
            >
              <ArrowLeftToLine className="h-3.5 w-3.5" aria-hidden />
              <span className="max-sm:hidden">To the start</span>
            </LayoutButton>
            <LayoutButton
              aria-label="To the end"
              title="To the end"
              disabled={unavailable}
              onClick={() => emit({ kind: 'move', destination: { kind: 'end' } })}
            >
              <ArrowRightToLine className="h-3.5 w-3.5" aria-hidden />
              <span className="max-sm:hidden">To the end</span>
            </LayoutButton>
            <LayoutButton
              onClick={() => {
                setMoving(false);
                setError(null);
              }}
            >
              Cancel
            </LayoutButton>
          </>
        ) : (
          <>
            <LayoutButton
              aria-label="Undo move"
              title="Undo move (⌘Z)"
              disabled={!steps.done.length || blocked}
              className="w-9 px-0"
              onClick={undo}
            >
              <Undo2 className="h-4 w-4" aria-hidden />
            </LayoutButton>
            <LayoutButton
              aria-label="Redo move"
              title="Redo move (⇧⌘Z)"
              disabled={!steps.undone.length || blocked}
              className="w-9 px-0"
              onClick={redo}
            >
              <Redo2 className="h-4 w-4" aria-hidden />
            </LayoutButton>
            <LayoutButton
              aria-label="Move"
              title="Move"
              disabled={unavailable || !ids.length || ids.length === binder.slots.length}
              className="max-sm:w-9 max-sm:px-0"
              onClick={() => {
                setMenu(null);
                setMoving(true);
                setError(null);
              }}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
              <span className="max-sm:hidden">Move</span>
            </LayoutButton>
            <LayoutButton
              aria-label="Add"
              title="Add"
              aria-haspopup="menu"
              aria-expanded={menu === 'add'}
              disabled={unavailable}
              className="max-sm:w-9 max-sm:px-0"
              onClick={() => setMenu(menu === 'add' ? null : 'add')}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              <span className="max-sm:hidden">Add</span>
            </LayoutButton>
            {boundary.bulkFill?.available && ids.length > 0 && (
              <LayoutButton
                aria-label="Fill"
                title="Fill"
                disabled={unavailable}
                className="max-sm:w-9 max-sm:px-0"
                onClick={() => {
                  setMenu(null);
                  setSheet('fill');
                }}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                <span className="max-sm:hidden">Fill</span>
              </LayoutButton>
            )}
            {boundary.removal && (
              <LayoutButton
                aria-label="Remove"
                title="Remove"
                disabled={unavailable || !ids.length || !boundary.removal.available}
                className="max-sm:w-9 max-sm:px-0"
                onClick={() => {
                  setMenu(null);
                  setSheet('remove');
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                <span className="max-sm:hidden">Remove</span>
              </LayoutButton>
            )}
            {(single || pageToMove) && (
              <LayoutButton
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={menu === 'more'}
                disabled={unavailable}
                className="w-9 px-0"
                onClick={() => setMenu(menu === 'more' ? null : 'more')}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </LayoutButton>
            )}
            <LayoutButton
              aria-pressed
              onClick={onDone}
              className="bg-primary text-primary-foreground hover:bg-primary/90 ml-0.5 px-3"
            >
              Done
            </LayoutButton>
          </>
        )}
      </div>
      {menu === 'add' && (
        <div role="menu" aria-label="Add an empty pocket" className={popover + ' sm:w-[26rem] sm:grid-cols-2'}>
          {first && (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => insert(1, { kind: 'before', slotId: first })}
            >
              Before the selection
            </button>
          )}
          {last && (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => insert(1, { kind: 'after', slotId: last })}
            >
              After the selection
            </button>
          )}
          <button type="button" role="menuitem" className={menuItem} onClick={() => insert(1, { kind: 'end' })}>
            At the end of the binder
          </button>
          {first && (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => insert(page, { kind: 'before', slotId: first })}
            >
              A new page before ({page} pockets)
            </button>
          )}
          <button type="button" role="menuitem" className={menuItem} onClick={() => insert(page, { kind: 'end' })}>
            A new page at the end ({page} pockets)
          </button>
        </div>
      )}
      {menu === 'more' && (single || pageToMove) && (
        <div role="menu" aria-label="More options" className={popover + ' sm:w-72'}>
          {pageToMove && (
            <button type="button" role="menuitem" className={menuItem} onClick={() => setMenu('page')}>
              Move page {pageToMove} to another page
            </button>
          )}
          {single && !single.inventoryItemId && (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => {
                setMenu(null);
                setSheet('reserve');
              }}
            >
              {single.target ? 'Change what goes here' : 'Choose what goes here'}
            </button>
          )}
          {single?.target && !single.inventoryItemId && (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              disabled={pocket.busy}
              onClick={() => {
                setMenu(null);
                pocket.run({ kind: 'target', target: null });
              }}
            >
              Let any card go here
            </button>
          )}
          {single?.inventoryItemId && (
            <button
              type="button"
              role="menuitem"
              className={cn(menuItem, 'flex-col items-start justify-center')}
              disabled={pocket.busy}
              onClick={() => {
                setMenu(null);
                pocket.run({ kind: 'clear' });
              }}
            >
              <span>Take the card out</span>
              <span className="text-muted-foreground text-xs font-normal">It stays in your collection.</span>
            </button>
          )}
        </div>
      )}
      {menu === 'page' && pageToMove && (
        <PageMovePanel from={pageToMove} pages={fullPages} disabled={unavailable} onMove={movePage} />
      )}
      {((state !== 'current' && !blocked) || failure) && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 grid gap-1">
          {state !== 'current' && !blocked && (
            <div role="alert" className={notice}>
              <span className="min-w-0 flex-1">These pockets changed since you selected them.</span>
              <LayoutButton
                onClick={() => {
                  setSelection(safeCapture(boundary, ids));
                  setMoving(false);
                  setError(null);
                }}
              >
                Update selection
              </LayoutButton>
            </div>
          )}
          {failure && (
            <div role="alert" className={notice}>
              <span className="min-w-0 flex-1 break-words">{failure}</span>
              {pending && (
                <LayoutButton disabled={busy} onClick={() => handoff(pending)}>
                  Try again
                </LayoutButton>
              )}
              {pending && (
                <LayoutButton
                  disabled={busy}
                  onClick={() => {
                    discard();
                    setError(null);
                  }}
                >
                  Discard
                </LayoutButton>
              )}
              {!pending && pocket.retry && (
                <LayoutButton disabled={pocket.busy} onClick={pocket.retry}>
                  Try again
                </LayoutButton>
              )}
              {!pending && pocket.failed && (
                <LayoutButton disabled={pocket.busy} onClick={pocket.dismiss}>
                  Dismiss
                </LayoutButton>
              )}
              {!pending && error && <LayoutButton onClick={() => setError(null)}>Dismiss</LayoutButton>}
            </div>
          )}
        </div>
      )}
      {sheet === 'remove' && (
        <SlotRemovalReview
          boundary={boundary}
          selection={selection}
          onClose={() => setSheet(null)}
          onRemoved={() => {
            setSheet(null);
            setSelection(captureBulkSelection(snapshot, scope, []));
          }}
        />
      )}
      {sheet === 'fill' && (
        <BulkFillReview boundary={boundary} selection={selection} grid={host} onClose={() => setSheet(null)} />
      )}
      {sheet === 'reserve' && single && (
        <PocketReserve
          boundary={{
            snapshot,
            scope: { ...scope, slotId: single.id },
            catalog,
            onCommandIntent: boundary.onCommandIntent,
          }}
          onClose={() => setSheet(null)}
          onSaved={keepSelection}
        />
      )}
    </section>
  );
}
