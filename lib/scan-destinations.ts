import { matchesSlotTarget, isSlotRevision } from '@/lib/domain/binder-slots';
import type { InventoryCatalogResolver, InventoryIdentity, InventorySnapshot } from '@/lib/domain/inventory';
import type { OperationIntentContext } from '@/lib/domain/audit-context';
import type { InventoryCommand, InsertInventorySelection } from '@/lib/domain/inventory-commands';
import type { StagedSlotCommandIntent, SlotLocalAcceptance } from '@/lib/binder-slot-editing';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import type { CardFinish } from '@/lib/domain/cards';
import { isCardLanguage } from '@/lib/domain/cards';
import { pickerCandidate, pickerChoices } from '@/lib/slot-picker';
import { matchesCatalogCardId } from '@/lib/card-catalog';
import { parseSlotIntent, projectSlotIntent } from '@/lib/collection/slot-optimistic';

export interface ScanDestinationView {
  ownerUserId: string;
  collectionId: string;
  /** Must change on account/session/unlink/relink, even for the same owner. */
  sessionId: string;
  rows: number;
  cols: number;
  /** Full actual page order, including free slots, no dex/filter-derived positions. */
  pageSlotIds: string[];
}
export interface ScanDestinationCapture extends ScanDestinationView {
  layoutRevision: number;
  orderedSlotIds: string[];
}
export interface ScanCell {
  index: number;
  row: number;
  col: number;
  occupied: boolean;
  /** The pocket's crop from the page photo, when the detector kept one. */
  cardImageDataUrl?: string;
}
export interface ScanChoice {
  cellIndex: number;
  slotId: string | null;
  /** Required with null slotId: explicitly append a free slot or this exact card target. */
  append?: 'free' | 'card';
  card: SearchCardResult;
  finish?: CardFinish;
  /** The pocket already holds a different card: put this one there instead, the old copy stays owned but unplaced. */
  replace?: true;
  /** Explicit recorded copy ID, or Raw reuse/create, never an OCR-derived grade. */
  copy: 'raw' | { inventoryItemId: string; itemVersion: number };
}
export interface ScanDestinationAdmission {
  snapshot: InventorySnapshot;
  view: ScanDestinationView;
  catalog: InventoryCatalogResolver;
  /** Resolve ONLY after durable local commit. Never a server ACK or a void draft callback. */
  onCommandIntent: (draft: StagedSlotCommandIntent, catalog: InventoryCatalogResolver) => Promise<SlotLocalAcceptance>;
}
const fail = (reason: string): never => {
  throw new Error(reason);
};

export function captureScanDestination(snapshot: InventorySnapshot, view: ScanDestinationView): ScanDestinationCapture {
  const binder = snapshot.binders.find((b) => b.collectionId === view.collectionId);
  if (
    !binder ||
    snapshot.ownerUserId !== view.ownerUserId ||
    binder.ownerUserId !== view.ownerUserId ||
    !view.sessionId ||
    !isSlotRevision(view.rows) ||
    !isSlotRevision(view.cols) ||
    view.rows < 1 ||
    view.cols < 1 ||
    view.rows * view.cols > 100 ||
    view.pageSlotIds.length > view.rows * view.cols ||
    new Set(view.pageSlotIds).size !== view.pageSlotIds.length
  )
    return fail('scan-stale');
  const orderedSlotIds = binder.slots.map((s) => s.id);
  const offset =
    orderedSlotIds.length === 0 && view.pageSlotIds.length === 0 ? 0 : orderedSlotIds.indexOf(view.pageSlotIds[0]);
  if (
    offset < 0 ||
    offset % (view.rows * view.cols) !== 0 ||
    JSON.stringify(orderedSlotIds.slice(offset, offset + view.rows * view.cols)) !== JSON.stringify(view.pageSlotIds)
  )
    return fail('scan-stale');
  return structuredClone({ ...view, layoutRevision: binder.layoutRevision, orderedSlotIds });
}

export function assertScanCurrent(
  snapshot: InventorySnapshot,
  view: ScanDestinationView,
  capture: ScanDestinationCapture,
) {
  const current = captureScanDestination(snapshot, view);
  if (JSON.stringify(current) !== JSON.stringify(capture)) fail('scan-stale');
}

export function mapScanCells(capture: ScanDestinationCapture, cells: readonly ScanCell[]) {
  const seen = new Set<number>();
  return cells
    .map((cell) => {
      if (
        !isSlotRevision(cell.index) ||
        cell.index >= capture.rows * capture.cols ||
        cell.row !== Math.floor(cell.index / capture.cols) ||
        cell.col !== cell.index % capture.cols ||
        typeof cell.occupied !== 'boolean' ||
        seen.has(cell.index)
      )
        return fail('invalid-scan-cell');
      seen.add(cell.index);
      // A trailing uncreated pocket stays unresolved, never mapped to the next page.
      return { ...cell, slotId: capture.pageSlotIds[cell.index] ?? null };
    })
    .sort((a, b) => a.index - b.index);
}

export function scanDestinations(
  snapshot: InventorySnapshot,
  view: ScanDestinationView,
  card: SearchCardResult,
  finish?: CardFinish,
) {
  const candidate = { ...pickerCandidate(card), ...(finish ? { finish } : {}) };
  return (
    snapshot.binders
      .find((b) => b.collectionId === view.collectionId)
      ?.slots.filter(
        (s) =>
          s.ownerUserId === view.ownerUserId && s.inventoryItemId === null && matchesSlotTarget(candidate, s.target),
      ) ?? []
  );
}

/** True when the scan has matches for a filled pocket and none of them is the card recorded there. */
export function scanShowsDifferentCard(candidates: readonly SearchCardResult[], recorded: InventoryIdentity) {
  return (
    candidates.length > 0 &&
    !candidates.some((c) =>
      recorded.kind === 'card' ? matchesCatalogCardId(c, recorded.cardId) : c.dexIds?.includes(recorded.pokemonId),
    )
  );
}

/** All reviewed cells become ONE immutable command. No per-cell save or positional assignment. */
export function prepareScanDraft(
  snapshot: InventorySnapshot,
  view: ScanDestinationView,
  capture: ScanDestinationCapture,
  choices: readonly ScanChoice[],
  context: OperationIntentContext,
  catalog: InventoryCatalogResolver,
) {
  assertScanCurrent(snapshot, view, capture);
  if (!choices.length || choices.length > 100) return fail('scan-unconfirmed');
  const collection = snapshot.collections.find((c) => c.id === view.collectionId) ?? fail('scan-stale');
  const binder = snapshot.binders.find((b) => b.collectionId === view.collectionId)!;
  const cells = new Set<number>(),
    slots = new Set<string>(),
    copies = new Set<string>();
  const commands: InventoryCommand[] = [];
  const resolve: InventoryCatalogResolver = (id) => {
    const card = choices.find((c) => matchesCatalogCardId(c.card, id))?.card;
    return card ? pickerCandidate(card) : catalog(id);
  };
  for (const choice of choices) {
    if (!isSlotRevision(choice.cellIndex) || choice.cellIndex >= capture.rows * capture.cols)
      return fail('invalid-scan-cell');
    if (cells.has(choice.cellIndex) || (choice.slotId !== null && slots.has(choice.slotId)))
      return fail('duplicate-scan-destination');
    cells.add(choice.cellIndex);
    if (choice.slotId !== null) slots.add(choice.slotId);
    if (choice.slotId === null && choice.append !== 'free' && choice.append !== 'card') return fail('scan-unconfirmed');
    const candidate = { ...pickerCandidate(choice.card), ...(choice.finish ? { finish: choice.finish } : {}) };
    const slot =
      choice.slotId === null
        ? null
        : choice.replace
          ? (binder.slots.find(
              (s) =>
                s.id === choice.slotId &&
                s.ownerUserId === view.ownerUserId &&
                s.inventoryItemId !== null &&
                matchesSlotTarget(candidate, s.target),
            ) ?? fail('target-mismatch'))
          : (scanDestinations(snapshot, view, choice.card, choice.finish).find((s) => s.id === choice.slotId) ??
            fail('target-mismatch'));
    const identity = {
      kind: 'card' as const,
      cardId: choice.card.canonicalId ?? choice.card.id,
      ...(isCardLanguage(choice.card.language) ? { language: choice.card.language } : {}),
      ...(choice.finish ? { finish: choice.finish } : {}),
    };
    let selection: InsertInventorySelection;
    if (choice.copy === 'raw') {
      // Existing matching copies keep the command contract authoritative.
      const available = { ...snapshot, items: snapshot.items.filter((i) => !copies.has(i.id)) };
      const eligible = pickerChoices(available, identity, resolve);
      const raw = eligible.find((c) => c.label === 'Raw')?.selection;
      if (raw?.kind === 'existing') selection = raw;
      else {
        if (eligible.length)
          return fail(
            'raw-creation-unavailable: choose a recorded copy; creating Raw beside graded-only copies is unsupported',
          );
        const id = crypto.randomUUID();
        if (slot) {
          commands.push({ kind: 'add', itemId: id, identity, grading: null, acquiredAt: null });
          selection = { kind: 'existing', inventoryItemId: id, itemVersion: 0 };
        } else selection = { kind: 'new', itemId: id, identity, grading: null, acquiredAt: null };
      }
    } else {
      const selectedCopy = choice.copy;
      const selectedItem = snapshot.items.find((i) => i.id === selectedCopy.inventoryItemId);
      const existing = pickerChoices(
        { ...snapshot, items: selectedItem ? [selectedItem] : [] },
        identity,
        resolve,
      ).find((c) => c.selection.kind === 'existing' && c.selection.inventoryItemId === selectedCopy.inventoryItemId);
      if (
        !existing ||
        existing.selection.kind !== 'existing' ||
        existing.selection.itemVersion !== choice.copy.itemVersion
      )
        return fail('copy-choice-required');
      selection = existing.selection;
    }
    const copyId = selection.kind === 'new' ? selection.itemId : selection.inventoryItemId;
    if (copies.has(copyId)) return fail('duplicate-scan-copy');
    if (slot && copyId === slot.inventoryItemId) return fail('replace-same-card');
    copies.add(copyId);
    if (!slot)
      commands.push({
        kind: 'insertAssign',
        collectionId: view.collectionId,
        slotId: crypto.randomUUID(),
        before: null,
        target: choice.append === 'card' ? identity : null,
        selection,
      });
    else if (selection.kind === 'existing')
      commands.push({
        kind: 'assign',
        selection,
        destination: {
          collectionId: view.collectionId,
          slot: {
            id: slot.id,
            version: slot.version,
            inventoryItemId: slot.inventoryItemId,
            itemVersion: snapshot.items.find((i) => i.id === slot.inventoryItemId)?.version ?? null,
            placementVersion:
              snapshot.placements.find((p) => p.inventoryItemId === slot.inventoryItemId)?.version ?? null,
          },
        },
        occupied: choice.replace ? 'unassign' : 'cancel',
        fulfillWant: null,
      });
  }
  try {
    const intent = parseSlotIntent({
      kind: 'inventory',
      context,
      request: {
        operationId: context.operationId,
        inventoryRevision: snapshot.inventoryRevision,
        collections: [
          { collectionId: collection.id, version: collection.version, layoutRevision: binder.layoutRevision },
        ],
        commands,
      },
    });
    return {
      scope: { ownerUserId: view.ownerUserId, collectionId: view.collectionId, slotId: null },
      intent,
      catalog: resolve,
      preview: projectSlotIntent(snapshot, intent, resolve),
    };
  } catch (cause) {
    if (cause instanceof Error && /oversized|capacity|evidence|bound|limit/i.test(cause.message))
      return fail(
        'Scan batch exceeds storage or evidence limits. Review a smaller page or fewer cells; nothing was saved.',
      );
    throw cause;
  }
}

/**
 * Several cards picked at once for one page: each goes into the first empty pocket on the page that accepts it, starting
 * at the pocket that was tapped and wrapping round. Fails with `page-full` when a card has nowhere left to go.
 */
export function planPageFill(
  snapshot: InventorySnapshot,
  view: ScanDestinationView,
  startSlotId: string,
  picks: readonly { card: SearchCardResult; finish?: CardFinish }[],
): ScanChoice[] {
  const start = Math.max(0, view.pageSlotIds.indexOf(startSlotId));
  const order = [...view.pageSlotIds.slice(start), ...view.pageSlotIds.slice(0, start)];
  const used = new Set<string>();
  return picks.map(({ card, finish }) => {
    const fits = new Set(scanDestinations(snapshot, view, card, finish).map((s) => s.id));
    const slotId = order.find((id) => fits.has(id) && !used.has(id)) ?? fail('page-full');
    used.add(slotId);
    return {
      cellIndex: view.pageSlotIds.indexOf(slotId),
      slotId,
      card,
      ...(finish ? { finish } : {}),
      copy: 'raw' as const,
    };
  });
}
