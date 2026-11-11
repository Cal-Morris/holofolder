import { backupContentKey } from '@/lib/binder-backup-v2';
import {
  isContractRecord,
  isSlotContractId,
  isSlotRevision,
  normalizeBinderSnapshot,
  type BinderSlot,
} from '@/lib/domain/binder-slots';
import { normalizeInventoryItem, type InventoryItem } from '@/lib/domain/inventory';
import {
  parseInventoryCommand,
  type InventoryItemRef,
  type InventoryCommandRequest,
} from '@/lib/domain/inventory-commands';
import { isBinderId } from '@/lib/binders/model';
import type { SlotPrecondition } from '@/lib/domain/slot-commands';
import type { PresetManifest } from '@/lib/domain/binder-presets';

export const BACKUP_IMPORT_LIMITS = { bytes: 8388608, slots: 4096, items: 5000 } as const;
export interface BackupArrangementCommand {
  version: 1;
  operationId: string;
  inventoryRevision: number;
  destinationCollectionId: string;
  collections: InventoryCommandRequest['collections'];
  emptyDestinationSlots: SlotPrecondition[];
  manifest: PresetManifest | null;
  slots: Omit<BinderSlot, 'collectionId' | 'ownerUserId' | 'version'>[];
  copies: { kind: 'add' | 'existing'; item: Omit<InventoryItem, 'ownerUserId'>; ref: InventoryItemRef | null }[];
}
const invalid = (): never => {
  throw new Error('Invalid or unsupported atomic arrangement import');
};
/** No owner, credentials, appearance, assets or frozen provenance is accepted as authority. */
export function parseBackupArrangementCommand(value: unknown): BackupArrangementCommand {
  if (
    new TextEncoder().encode(JSON.stringify(value) ?? '').length > BACKUP_IMPORT_LIMITS.bytes ||
    !isContractRecord(value, [
      'version',
      'operationId',
      'inventoryRevision',
      'destinationCollectionId',
      'collections',
      'emptyDestinationSlots',
      'manifest',
      'slots',
      'copies',
    ]) ||
    Object.keys(value).length !== 9 ||
    value.version !== 1 ||
    !isSlotContractId(value.operationId) ||
    value.operationId.length < 8 ||
    value.operationId.length > 100 ||
    !isSlotRevision(value.inventoryRevision) ||
    !isBinderId(value.destinationCollectionId) ||
    !Array.isArray(value.collections) ||
    !value.collections.length ||
    value.collections.length > 32 ||
    !Array.isArray(value.slots) ||
    !value.slots.length ||
    value.slots.length > BACKUP_IMPORT_LIMITS.slots ||
    !Array.isArray(value.copies) ||
    value.copies.length > BACKUP_IMPORT_LIMITS.items
  )
    return invalid();
  const ownerUserId = 'validation';
  const slots = value.slots.map((s) => {
    if (
      !isContractRecord(s, ['id', 'target', 'status', 'wantedCards', 'inventoryItemId', 'presetOrigin']) ||
      Object.keys(s).length !== 6
    )
      return invalid();
    return { ...s, collectionId: value.destinationCollectionId, ownerUserId, version: 0 };
  });
  const binder = normalizeBinderSnapshot({
    collectionId: value.destinationCollectionId,
    ownerUserId,
    layoutRevision: 0,
    presetManifest: value.manifest,
    slots,
  });
  if (!binder || backupContentKey(binder.presetManifest) !== backupContentKey(value.manifest)) return invalid();
  const tokens = new Map<string, unknown>();
  for (const c of value.collections) {
    if (
      !isContractRecord(c, ['collectionId', 'version', 'layoutRevision']) ||
      Object.keys(c).length !== 3 ||
      !isBinderId(c.collectionId) ||
      !isSlotRevision(c.version) ||
      !isSlotRevision(c.layoutRevision) ||
      tokens.has(c.collectionId)
    )
      return invalid();
    tokens.set(c.collectionId, c);
  }
  if (!tokens.has(value.destinationCollectionId)) return invalid();
  const empty = parseInventoryCommand({
    operationId: value.operationId,
    inventoryRevision: value.inventoryRevision,
    collections: [tokens.get(value.destinationCollectionId)],
    commands: [
      {
        kind: 'deleteCollection',
        collectionId: value.destinationCollectionId,
        slots: value.emptyDestinationSlots,
        replacementDefaultCollectionId: null,
      },
    ],
  });
  if (
    empty.commands[0].kind !== 'deleteCollection' ||
    empty.commands[0].slots.some((s) => s.inventoryItemId !== null) ||
    new Set(empty.commands[0].slots.map((s) => s.id)).size !== empty.commands[0].slots.length
  )
    return invalid();
  const ids = new Set<string>();
  const required = new Set([value.destinationCollectionId]);
  for (const c of value.copies) {
    if (
      !isContractRecord(c, ['kind', 'item', 'ref']) ||
      Object.keys(c).length !== 3 ||
      !isContractRecord(c.item, ['id', 'identity', 'grading', 'acquiredAt', 'version']) ||
      Object.keys(c.item).length !== 5
    )
      return invalid();
    const item = normalizeInventoryItem({ ...c.item, ownerUserId });
    if (!item || ids.has(item.id) || item.grading?.label.assetIds.length) return invalid();
    ids.add(item.id);
    if (c.kind === 'add') {
      if (c.ref !== null || item.version !== 0) return invalid();
    } else if (c.kind === 'existing') {
      const command = parseInventoryCommand({
        operationId: value.operationId,
        inventoryRevision: value.inventoryRevision,
        collections: value.collections,
        commands: [{ kind: 'unassign', item: c.ref }],
      });
      const ref = (command.commands[0] as { item: InventoryItemRef }).item;
      if (ref.itemId !== item.id || ref.itemVersion !== item.version) return invalid();
      if (ref.placement) required.add(ref.placement.collectionId);
    } else return invalid();
  }
  if (required.size !== tokens.size) return invalid();
  const placed = new Set<string>();
  for (const s of binder.slots) {
    if (s.inventoryItemId !== null) {
      if (!ids.has(s.inventoryItemId) || placed.has(s.inventoryItemId)) return invalid();
      placed.add(s.inventoryItemId);
    }
    for (const w of s.wantedCards)
      if (w.card_image) {
        const u = new URL(w.card_image);
        if (
          u.protocol !== 'https:' ||
          !['assets.tcgdex.net', 'assets.holofolder.com'].includes(u.hostname) ||
          u.username ||
          u.password ||
          u.port ||
          u.search ||
          u.hash
        )
          return invalid();
      }
  }
  // Every existing copy must have an explicit destination; no accidental release to Unassigned.
  if (value.copies.some((c) => c.kind === 'existing' && !placed.has(c.item.id))) return invalid();
  return structuredClone(value) as unknown as BackupArrangementCommand;
}
