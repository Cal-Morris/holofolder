import type { StagedSlotCommandIntent } from '@/lib/binder-slot-editing';
import { browserHostCatalog } from '@/lib/collection/browser-host-catalog';
import { parseNavigationEvidence } from '@/lib/collection/inventory-read-transport';
import type { InventoryCatalogEvidence } from '@/lib/domain/inventory-browse';
import type { InventorySnapshot } from '@/lib/domain/inventory';
import type { SlotOfflineRecord, SlotOfflineScope } from '@/lib/collection/slot-offline-queue';
import { sameValue, type SlotOfflineIntent } from '@/lib/collection/slot-optimistic';

export const slotNavigationKey = (scope: SlotOfflineScope) =>
  `slot-navigation-v1:${JSON.stringify([scope.deviceId, scope.accountId, scope.ownerUserId])}`;

/** Local catalog facts only. Conflicting associations remain unavailable to the planner. */
export function localCatalogEvidence(
  snapshot: InventorySnapshot,
  ...groups: readonly (readonly InventoryCatalogEvidence[])[]
) {
  const catalog: InventoryCatalogEvidence[] = [];
  const byCard = new Map<string, InventoryCatalogEvidence>();
  for (const group of groups) {
    const parsed = parseNavigationEvidence({ catalog: group, layouts: [] }, snapshot);
    if (!parsed) throw new Error('local-catalog-evidence-invalid');
    for (const entry of parsed.catalog) {
      const cardKey = JSON.stringify([entry.card.id, entry.card.language]);
      const existing = byCard.get(cardKey);
      if (
        existing &&
        !sameValue(
          [existing.card.canonicalId, existing.card.aliasIds, existing.pokemonIds],
          [entry.card.canonicalId, entry.card.aliasIds, entry.pokemonIds],
        )
      )
        throw new Error('local-catalog-association-conflict');
      if (!existing) {
        catalog.push(entry);
        byCard.set(cardKey, entry);
      }
    }
  }
  const resolve = browserHostCatalog(catalog);
  if (catalog.some((c) => c.pokemonIds && !resolve(c.card.id))) throw new Error('local-catalog-association-conflict');
  return catalog;
}

/** Called only with the canonical record read inside the queue transaction. */
export function savedLocalPlanning(record: SlotOfflineRecord, metadata: unknown, authSessionId: string) {
  if (!record.snapshot || !record.optimistic) throw new Error('native-startup-not-saved');
  const parsed = parseNavigationEvidence(metadata, record.snapshot);
  if (!parsed || parsed.layouts.length !== record.snapshot.binders.length)
    throw new Error('native-startup-metadata-unavailable');
  const catalog = localCatalogEvidence(
    record.snapshot,
    parsed.catalog,
    ...record.pending.map((p) => p.localCatalog ?? []),
  );
  const layouts = parsed.layouts.map((layout) => {
    const binder = record.optimistic!.binders.find((b) => b.collectionId === layout.collectionId);
    if (!binder) throw new Error('native-startup-layout-unavailable');
    return { ...layout, layoutRevision: binder.layoutRevision };
  });
  return {
    scope: structuredClone(record.scope),
    authSessionId,
    snapshot: record.optimistic,
    pending: record.pending.filter((p) => p.status !== 'acknowledged').length,
    catalog,
    layouts,
    resolver: browserHostCatalog(catalog),
  };
}

/** The exact single-command families produced by layout and picker preparation. */
export function isBasicLocalDraft(draft: { scope: StagedSlotCommandIntent['scope']; intent: SlotOfflineIntent }) {
  const { intent, scope } = draft;
  if (
    (intent.kind !== 'slots' && intent.kind !== 'inventory') ||
    intent.context.source !== 'app' ||
    intent.request.commands.length !== 1
  )
    return false;
  if (intent.kind === 'slots') {
    if (intent.request.collectionId !== scope.collectionId) return false;
    const c = intent.request.commands[0];
    return c.kind === 'create'
      ? c.ids.length === 1
      : c.kind === 'move' || c.kind === 'clear'
        ? c.slots.length === 1 && c.slots[0].id === scope.slotId
        : c.kind === 'update' && c.slot.id === scope.slotId && 'target' in c && !('wantedCards' in c);
  }
  const c = intent.request.commands[0];
  return (
    c.kind === 'assign' &&
    c.occupied === 'cancel' &&
    c.destination.collectionId === scope.collectionId &&
    c.destination.slot.id === scope.slotId &&
    intent.request.collections.length === 1 &&
    intent.request.collections[0].collectionId === scope.collectionId
  );
}
