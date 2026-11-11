import { isBinderGridSize, withBinderLayout } from '@/lib/binder-layout';
import { settingsFromRow } from '@/lib/settings';
import type { InventoryReadEvidence } from '@/lib/collection/inventory-read-transport';
import type { InventoryLayoutEvidence } from '@/lib/domain/inventory-browse';
import {
  isSlotRevision,
  normalizeBinderSlot,
  normalizeBinderSnapshot,
  type BinderSlot,
} from '@/lib/domain/binder-slots';
import {
  normalizeInventoryItem,
  normalizePlacement,
  normalizeStorageCollection,
  type InventoryItem,
  type Placement,
  type StorageCollection,
} from '@/lib/domain/inventory';
import { readCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot';

/** Private read failure. Transports map it to their own projection. */
export class InventoryReadError extends Error {
  constructor(
    readonly code:
      | 'inventory_sign_in_required'
      | 'inventory_read_forbidden'
      | 'inventory_read_unavailable'
      | 'inventory_not_initialized',
    readonly status: 401 | 403 | 503,
  ) {
    super(code);
  }
}
export type Row = Record<string, unknown>;
export const unavailable = (): never => {
  throw new InventoryReadError('inventory_read_unavailable', 503);
};
export const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
export const rows = (value: unknown): Row[] => (Array.isArray(value) && value.every(isRow) ? value : unavailable());
const valid = <T>(value: T | undefined): T => (value === undefined ? unavailable() : value);

// inventory_snapshot_v2 rows → domain records. Database JSON is still untrusted input.
export const toItem = (r: Row, ownerUserId: string): InventoryItem =>
  valid(
    normalizeInventoryItem({
      id: r.id,
      ownerUserId,
      identity: r.identity,
      grading: r.grading,
      acquiredAt: r.acquired_at,
      version: r.version,
    }),
  );
export const toPlacement = (r: Row): Placement =>
  valid(
    normalizePlacement({
      inventoryItemId: r.inventory_item_id,
      collectionId: r.collection_id,
      slotId: r.slot_id,
      version: r.version,
    }),
  );
export const toCollection = (c: Row, ownerUserId: string): StorageCollection => {
  // A binder without its native storage row (or the reverse) isn't a readable native collection.
  if (c.binder !== true || c.state !== true) throw new InventoryReadError('inventory_not_initialized', 503);
  if (!isSlotRevision(c.layout_revision)) return unavailable();
  return valid(
    normalizeStorageCollection({
      id: c.id,
      ownerUserId,
      name: c.name,
      kind: c.kind,
      defaultPresentation: c.default_presentation,
      location: c.location,
      version: c.version,
    }),
  );
};
export const toSlot = (r: Row, ownerUserId: string, collectionId: string, inventoryItemId: string | null): BinderSlot =>
  valid(
    normalizeBinderSlot({
      id: r.id,
      ownerUserId,
      collectionId,
      target: r.target,
      status: r.status,
      wantedCards: r.wanted_cards,
      version: r.version,
      presetOrigin: r.preset_origin,
      inventoryItemId,
    }),
  );
export const collectionMetadata = (c: Row) => ({
  isDefault: typeof c.is_default === 'boolean' ? c.is_default : null,
  sortOrder: isSlotRevision(c.sort_order) ? c.sort_order : null,
  updatedAt: typeof c.updated_at === 'string' ? c.updated_at : null,
});
/** The binder's own grid, else the owner's settings. Invalid stored values are unknown, never guessed. */
export function collectionGrid(c: Row, settings: Row | null): { rows: number; cols: number } | null {
  const known = (v: unknown) => v === null || isBinderGridSize(v);
  if (!known(c.binder_rows) || !known(c.binder_cols)) return null;
  if (
    settings &&
    ((c.binder_rows === null && !known(settings.binder_rows)) ||
      (c.binder_cols === null && !known(settings.binder_cols)))
  )
    return null;
  const grid = withBinderLayout(settingsFromRow(settings), {
    rows: c.binder_rows as number | null,
    cols: c.binder_cols as number | null,
  });
  return { rows: grid.binderRows, cols: grid.binderCols };
}

/** One inventory_snapshot_v2('all') document, read in one MVCC snapshot, into a branded complete snapshot. */
export async function parseInventorySnapshot(doc: unknown, owner: string, settings: Row | null) {
  if (!isRow(doc) || (settings !== null && !isRow(settings))) return unavailable();
  const collectionRows = rows(doc.collections),
    itemRows = rows(doc.items),
    placementRows = rows(doc.placements);
  // No owner state row means an untouched owner (revision 0), but only with nothing stored yet.
  if (doc.revision === null && (collectionRows.length || itemRows.length || placementRows.length))
    throw new InventoryReadError('inventory_not_initialized', 503);
  const inventoryRevision = doc.revision ?? 0;
  if (!isSlotRevision(inventoryRevision)) return unavailable();
  const items = itemRows.map((r) => toItem(r, owner)),
    placements = placementRows.map(toPlacement);
  const placed = new Map(placements.map((p) => [p.slotId, p.inventoryItemId]));
  const collections = collectionRows.map((c) => toCollection(c, owner));
  const binders = collectionRows.map((c) => {
    const collectionId = String(c.id);
    const slots = rows(c.slots).map((r) => toSlot(r, owner, collectionId, placed.get(String(r.id)) ?? null));
    return valid(
      normalizeBinderSnapshot({
        ownerUserId: owner,
        collectionId,
        layoutRevision: c.layout_revision,
        presetManifest: c.preset_manifest,
        slots,
      }),
    );
  });
  const page =
    <T>(list: T[]) =>
    async () => ({ inventoryRevision, total: list.length, rows: list, next: null });
  // Brands it as a complete read; the shared normalizer checks the owner-wide slot/placement bijection.
  const snapshot = await readCompleteInventorySnapshot(owner, inventoryRevision, {
    items: page(items),
    placements: page(placements),
    collections: page(collections),
    binders: page(binders),
  }).catch(unavailable);
  const layouts: InventoryLayoutEvidence[] = [];
  for (const [i, c] of collectionRows.entries()) {
    const grid = collectionGrid(c, settings);
    if (grid) layouts.push({ collectionId: String(c.id), layoutRevision: binders[i].layoutRevision, ...grid });
  }
  const evidence: InventoryReadEvidence = {
    inventoryRevision,
    items: items.length,
    placements: placements.length,
    collections: collections.length,
    binders: binders.length,
    slots: binders.reduce((n, b) => n + b.slots.length, 0),
    storage: binders.map((b, i) => ({
      collectionId: b.collectionId,
      collectionVersion: collections[i].version,
      layoutRevision: b.layoutRevision,
      slotCount: b.slots.length,
    })),
  };
  return {
    snapshot,
    evidence,
    layouts,
    collectionMetadata: Object.fromEntries(collectionRows.map((c) => [String(c.id), collectionMetadata(c)])),
  };
}
