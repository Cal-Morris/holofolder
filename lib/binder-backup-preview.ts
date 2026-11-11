import { parseBackupArrangementCommand, type BackupArrangementCommand } from '@/lib/domain/backup-import-command';
import {
  backupContentKey,
  createBinderBackupV2,
  freezeBackupPlan,
  hydrateBackupSnapshot,
  parseBinderBackupV2,
  type BinderBackupV2,
} from '@/lib/binder-backup-v2';
import {
  inventoryItemCandidate,
  normalizeInventorySnapshot,
  type InventoryCatalogResolver,
  type InventorySnapshot,
} from '@/lib/domain/inventory';
import { matchesSlotTarget, isSlotContractId } from '@/lib/domain/binder-slots';
import { getPokemonById } from '@/lib/pokemon-catalog';
import { parseInventoryCommand, type InventoryCommandRequest } from '@/lib/domain/inventory-commands';

export type BackupImportMode = 'restore-current-owner' | 'arrangement' | 'additional-copies';
export type BackupCopyDecision = { sourceItemId: string } & (
  { kind: 'add-copy' } | { kind: 'use-existing'; itemId: string }
);
export interface BackupImportPreview {
  operationId: string;
  mode: BackupImportMode;
  backup: BinderBackupV2;
  /** Complete trusted snapshot evidence. Never export this evidence into a portable backup. */
  precondition: string;
  /** Imported fragment only, not a replacement owner snapshot or a committed state. */
  proposed: InventorySnapshot;
  decisions: BackupCopyDecision[];
  moves: { itemId: string; from: string | null; to: string }[];
  replacedEmptySlotIds: string[];
  addedCopies: number;
  addedWants: number;
  unresolved: string[];
  execution:
    | { kind: 'noop' }
    | { kind: 'inventory-command'; request: InventoryCommandRequest }
    | { kind: 'arrangement-command'; request: BackupArrangementCommand }
    | { kind: 'blocked'; reasons: string[] };
}

/** Internal only, never an authenticated route or a durable write store.
 * trustedSource must come from verified current-owner export provenance, not backup fields.
 * savedEntryRemaining comes from authoritative billing, not file contents or cached UI counts. */
export function previewBinderBackupImport(input: {
  text: string;
  current: InventorySnapshot;
  completeness: 'complete-owner' | 'partial';
  mode: BackupImportMode;
  operationId: string;
  newId: () => string;
  resolveCatalog: InventoryCatalogResolver;
  savedEntryRemaining: number;
  trustedSource?: InventorySnapshot;
  partnerUserId?: string;
  destinationCollectionId?: string;
  decisions?: BackupCopyDecision[];
}): BackupImportPreview {
  const backup = parseBinderBackupV2(input.text);
  const current = normalizeInventorySnapshot(input.current);
  if (!current || input.completeness !== 'complete-owner') throw new Error('Complete current-owner snapshot required');
  if (
    !isSlotContractId(input.operationId) ||
    input.operationId.length < 8 ||
    input.operationId.length > 100 ||
    !Number.isSafeInteger(input.savedEntryRemaining) ||
    input.savedEntryRemaining < 0 ||
    !['restore-current-owner', 'arrangement', 'additional-copies'].includes(input.mode)
  )
    throw new Error('Invalid preview options');
  const precondition = backupContentKey(current);
  const unresolved: string[] = [];
  const decisions = structuredClone(input.decisions ?? []);
  // Additional copies discard source arrangements and wants, so no partner remapping applies.
  const proposed: InventorySnapshot =
    input.mode === 'additional-copies'
      ? {
          ownerUserId: current.ownerUserId,
          inventoryRevision: current.inventoryRevision,
          items: [],
          placements: [],
          collections: [],
          binders: [],
        }
      : hydrateBackupSnapshot(backup, current.ownerUserId, input.partnerUserId);
  proposed.inventoryRevision = current.inventoryRevision;
  let addedCopies = 0;
  let addedWants = 0;
  const moves: BackupImportPreview['moves'] = [];
  const replacedEmptySlotIds: string[] = [];
  const finish = (execution: BackupImportPreview['execution']): BackupImportPreview =>
    freezeBackupPlan({
      operationId: input.operationId,
      mode: input.mode,
      backup,
      precondition,
      proposed,
      decisions,
      moves,
      addedCopies,
      addedWants,
      replacedEmptySlotIds,
      unresolved,
      execution,
    });
  if (input.mode === 'restore-current-owner') {
    if (decisions.length) throw new Error('Restore cannot create additional copies implicitly');
    if (!input.trustedSource || input.trustedSource.ownerUserId !== current.ownerUserId)
      throw new Error('Verified current-owner export provenance required');
    const source = createBinderBackupV2(
      {
        snapshot: input.trustedSource,
        partnerUserId: input.partnerUserId,
        completeness: 'complete-owner',
        scope: backup.scope,
        collectionId: backup.scope === 'collection' ? backup.collections[0].id : undefined,
      },
      new Date(backup.exportedAt),
    );
    if (backupContentKey({ ...source, appearance: [] }) !== backupContentKey({ ...backup, appearance: [] }))
      throw new Error('Backup does not match trusted export provenance');
    const currentExport = createBinderBackupV2(
      {
        snapshot: current,
        partnerUserId: input.partnerUserId,
        completeness: 'complete-owner',
        scope: backup.scope,
        collectionId: backup.scope === 'collection' ? backup.collections[0].id : undefined,
      },
      new Date(backup.exportedAt),
    );
    if (
      backupContentKey({ ...currentExport, appearance: [] }) === backupContentKey({ ...backup, appearance: [] }) &&
      !backup.appearance.length
    )
      return finish({ kind: 'noop' });
    return finish({
      kind: 'blocked',
      reasons: [
        'Restore requires atomic slot/item/placement/preset/settings reconciliation and version-safe inverse; current executors cannot admit the complete intent',
        'Reconcile changed partner item, placement and layout versions explicitly; never overwrite current state',
      ],
    });
  }
  const usedIds = new Set([
    ...current.items.map((i) => i.id),
    ...current.collections.map((c) => c.id),
    ...current.binders.flatMap((b) => b.slots.map((s) => s.id)),
    ...backup.items.map((i) => i.id),
    ...backup.collections.map((c) => c.id),
    ...backup.binders.flatMap((b) => b.slots.map((s) => s.id)),
  ]);
  const allocate = () => {
    const id = input.newId();
    if (!isSlotContractId(id) || usedIds.has(id)) throw new Error('ID generator returned an invalid or duplicate ID');
    usedIds.add(id);
    return id;
  };
  if (
    new Set(decisions.map((d) => d.sourceItemId)).size !== decisions.length ||
    decisions.some(
      (d) => !backup.items.some((i) => i.id === d.sourceItemId) || !['add-copy', 'use-existing'].includes(d.kind),
    )
  )
    throw new Error('Invalid copy decisions');
  if (input.mode === 'additional-copies' && decisions.some((d) => d.kind !== 'add-copy'))
    throw new Error('Additional-copy import only accepts explicit add-copy decisions');
  const selected = new Map<string, string>();
  const existing = new Set<string>();
  proposed.items = [];
  for (const item of backup.items) {
    const decision = decisions.find((d) => d.sourceItemId === item.id);
    if (!decision) {
      if (input.mode === 'additional-copies') unresolved.push(`Choose add-copy explicitly for ${item.id}`);
      continue;
    }
    if (decision.kind === 'use-existing') {
      const owned = current.items.find((i) => i.id === decision.itemId);
      if (!owned || existing.has(owned.id)) throw new Error('Select each trusted existing copy at most once');
      // Equality checks compatibility only; it never establishes ownership identity.
      if (
        backupContentKey(owned.identity) !== backupContentKey(item.identity) ||
        backupContentKey(owned.grading) !== backupContentKey(item.grading)
      )
        throw new Error('Selected copy metadata differs; resolve explicitly');
      existing.add(owned.id);
      selected.set(item.id, owned.id);
      proposed.items.push(structuredClone(owned));
    } else {
      const id = allocate();
      selected.set(item.id, id);
      proposed.items.push({ ...structuredClone(item), id, ownerUserId: current.ownerUserId, version: 0 });
      addedCopies++;
    }
  }
  for (const item of proposed.items) {
    if (item.identity.kind === 'card' && !inventoryItemCandidate(item, input.resolveCatalog))
      unresolved.push(`Resolve catalog printing for ${item.id}`);
    if (item.identity.kind === 'pokemon' && !getPokemonById(item.identity.pokemonId))
      unresolved.push(`Resolve Pokémon identity for ${item.id}`);
  }
  if (input.mode === 'additional-copies') {
    proposed.binders = [];
    proposed.collections = [];
    proposed.placements = [];
  } else {
    if (backup.collections.length !== 1 || !input.destinationCollectionId)
      throw new Error('Arrangement preview requires one source and an explicit destination collection');
    const destination = current.collections.find((c) => c.id === input.destinationCollectionId);
    if (!destination) throw new Error('Destination must be in trusted current-owner inventory');
    proposed.collections = [structuredClone(destination)];
    proposed.placements = [];
    for (const b of proposed.binders) {
      b.collectionId = destination.id;
      b.layoutRevision = current.binders.find((c) => c.collectionId === destination.id)!.layoutRevision;
      for (const slot of b.slots) {
        const sourceItemId = slot.inventoryItemId;
        slot.id = allocate();
        slot.collectionId = destination.id;
        slot.version = 0;
        slot.inventoryItemId = sourceItemId === null ? null : (selected.get(sourceItemId) ?? null);
        if (slot.inventoryItemId === null && ['collected', 'finalized'].includes(slot.status ?? '')) slot.status = null;
        addedWants +=
          Math.max(slot.wantedCards.length, slot.status === 'wishlisted' ? 1 : 0) +
          (slot.status === 'considering' ? 1 : 0);
        if (
          (slot.target?.kind === 'card' && !input.resolveCatalog(slot.target.cardId)) ||
          (slot.target?.kind === 'pokemon' && !getPokemonById(slot.target.pokemonId))
        )
          unresolved.push(`Resolve target for ${slot.id}`);
        for (const want of slot.wantedCards)
          if (!input.resolveCatalog(want.card_id)) unresolved.push(`Resolve wanted printing for ${slot.id}`);
        if (slot.inventoryItemId !== null) {
          const item =
            proposed.items.find((i) => i.id === slot.inventoryItemId) ??
            current.items.find((i) => i.id === slot.inventoryItemId)!;
          const candidate = inventoryItemCandidate(item, input.resolveCatalog);
          if (!candidate || !matchesSlotTarget(candidate, slot.target))
            unresolved.push(`Resolve target match for ${slot.id}`);
          const from = current.placements.find((p) => p.inventoryItemId === item.id);
          if (existing.has(item.id)) moves.push({ itemId: item.id, from: from?.slotId ?? null, to: slot.id });
          proposed.placements.push({
            inventoryItemId: item.id,
            collectionId: destination.id,
            slotId: slot.id,
            version: 0,
          });
        }
      }
    }
  }
  if (addedCopies + addedWants > input.savedEntryRemaining)
    unresolved.push('Import exceeds current saved-entry allowance');
  if (input.mode === 'arrangement') {
    const destination = current.binders.find((b) => b.collectionId === input.destinationCollectionId)!;
    if (backup.layouts?.length)
      unresolved.push('Verified grid reconciliation requires complete restore review, not arrangement import');
    if (backup.appearance.length)
      unresolved.push('Appearance/settings require a complete restore, not arrangement import');
    if (decisions.length !== backup.items.length)
      unresolved.push('Choose an explicit copy decision for every source item');
    if (destination.slots.some((s) => s.inventoryItemId !== null || s.status !== null || s.wantedCards.length))
      unresolved.push('Destination must contain only empty targets/spacers; recorded contents cannot be replaced');
    replacedEmptySlotIds.push(...destination.slots.map((s) => s.id));
    if (backupContentKey(destination.presetManifest) !== backupContentKey(proposed.binders[0].presetManifest))
      unresolved.push('Destination copied manifest must already match; config replacement is not supported');
    if (unresolved.length) return finish({ kind: 'blocked', reasons: [...unresolved] });
    const collectionIds = new Set([destination.collectionId]);
    const copies = proposed.items.map((i) => {
      const { ownerUserId: _owner, ...item } = i;
      if (!existing.has(i.id)) return { kind: 'add' as const, item, ref: null };
      const placement = current.placements.find((p) => p.inventoryItemId === i.id);
      const slot = placement
        ? current.binders
            .find((b) => b.collectionId === placement.collectionId)!
            .slots.find((s) => s.id === placement.slotId)!
        : null;
      if (placement) collectionIds.add(placement.collectionId);
      return {
        kind: 'existing' as const,
        item,
        ref: {
          itemId: i.id,
          itemVersion: i.version,
          placement:
            placement && slot
              ? {
                  collectionId: placement.collectionId,
                  slot: {
                    id: slot.id,
                    version: slot.version,
                    inventoryItemId: i.id,
                    itemVersion: i.version,
                    placementVersion: placement.version,
                  },
                }
              : null,
        },
      };
    });
    try {
      const request = parseBackupArrangementCommand({
        version: 1,
        operationId: input.operationId,
        inventoryRevision: current.inventoryRevision,
        destinationCollectionId: destination.collectionId,
        collections: current.collections
          .filter((c) => collectionIds.has(c.id))
          .map((c) => ({
            collectionId: c.id,
            version: c.version,
            layoutRevision: current.binders.find((b) => b.collectionId === c.id)!.layoutRevision,
          })),
        emptyDestinationSlots: destination.slots.map((s) => ({
          id: s.id,
          version: s.version,
          inventoryItemId: null,
          itemVersion: null,
          placementVersion: null,
        })),
        manifest: proposed.binders[0].presetManifest,
        slots: proposed.binders[0].slots.map(
          ({ ownerUserId: _owner, collectionId: _collection, version: _version, ...s }) => s,
        ),
        copies,
      });
      return finish({ kind: 'arrangement-command', request });
    } catch {
      return finish({
        kind: 'blocked',
        reasons: ['Whole arrangement exceeds supported atomic import constraints; no partial batches are allowed'],
      });
    }
  }
  if (unresolved.length) return finish({ kind: 'blocked', reasons: [...unresolved] });
  if (!addedCopies) return finish({ kind: 'noop' });
  try {
    const request = parseInventoryCommand({
      operationId: input.operationId,
      inventoryRevision: current.inventoryRevision,
      collections: [],
      commands: proposed.items.map((item) => ({
        kind: 'add',
        itemId: item.id,
        identity: item.identity,
        grading: item.grading,
        acquiredAt: item.acquiredAt,
      })),
    });
    return finish({ kind: 'inventory-command', request });
  } catch {
    return finish({
      kind: 'blocked',
      reasons: ['Whole import exceeds canonical atomic inventory command limits; no partial batches are allowed'],
    });
  }
}

/** Any partner/item/placement/layout change invalidates the entire preview before submission. */
export function assertBackupPreviewCurrent(preview: BackupImportPreview, current: InventorySnapshot): void {
  const normalized = normalizeInventorySnapshot(current);
  if (!normalized || backupContentKey(normalized) !== preview.precondition)
    throw new Error('Import preview is stale; refresh and review again');
}
