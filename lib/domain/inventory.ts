import { matchesCatalogCardId } from '@/lib/card-catalog';
import {
  isContractRecord,
  isSlotContractId,
  isSlotRevision,
  normalizeBinderSnapshot,
  getBinderCompletion,
  type BinderSnapshot,
  type SlotTargetCandidate,
} from '@/lib/domain/binder-slots';
import { isCardFinish, isCardLanguage, type CardFinish, type CardLanguage } from '@/lib/domain/cards';

export type InventoryIdentity =
  | { kind: 'card'; cardId: string; language?: CardLanguage; finish?: CardFinish }
  | { kind: 'pokemon'; pokemonId: number };

export interface GradingRecord {
  provider: { kind: 'known'; id: 'psa' | 'ace' | 'cgc' | 'beckett' } | { kind: 'custom'; name: string };
  grade: string | null;
  scale: string | null;
  designation: string | null;
  subgrades: { name: string; grade: string }[];
  certificate: string | null;
  holder: string | null;
  label: { variant: string | null; assetIds: string[] };
}

export interface InventoryItem {
  id: string;
  ownerUserId: string;
  identity: InventoryIdentity;
  grading: GradingRecord | null;
  acquiredAt: string | null;
  version: number;
}

/** Absence means Unassigned, not an item deletion or a synthetic collection. */
export interface Placement {
  inventoryItemId: string;
  collectionId: string;
  slotId: string;
  version: number;
}
export type StorageKind = 'binder' | 'slab' | 'custom';
export type StoragePresentation = 'binder' | 'slabs' | 'list';
export interface StorageCollection {
  /** Omission is unknown on old snapshots, null is a recorded absence. Owner/partner only. */
  location?: string | null;
  id: string;
  ownerUserId: string;
  name: string;
  kind: StorageKind;
  defaultPresentation: StoragePresentation;
  version: number;
}

/** Complete owner-scoped view for pure planning, not a proposed database or transport payload. */
export interface InventorySnapshot {
  ownerUserId: string;
  inventoryRevision: number;
  items: InventoryItem[];
  placements: Placement[];
  collections: StorageCollection[];
  binders: BinderSnapshot[];
}
export interface InventoryDisplayReference {
  inventoryItemId: string;
}
export type InventoryCatalogResolver = (cardId: string) => Extract<SlotTargetCandidate, { kind: 'card' }> | undefined;

export function getStoragePresentationDefault(kind: StorageKind): StoragePresentation {
  return kind === 'binder' ? 'binder' : kind === 'slab' ? 'slabs' : 'list';
}
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
const nullableText = (value: unknown): value is string | null => value === null || text(value);

export function normalizeInventoryIdentity(value: unknown): InventoryIdentity | undefined {
  if (!isContractRecord(value, ['kind', 'cardId', 'language', 'finish', 'pokemonId'])) return undefined;
  if (value.kind === 'pokemon') {
    if (
      Object.keys(value).some((key) => !['kind', 'pokemonId'].includes(key)) ||
      !isSlotRevision(value.pokemonId) ||
      value.pokemonId === 0
    )
      return undefined;
    return { kind: 'pokemon', pokemonId: value.pokemonId };
  }
  if (
    value.kind !== 'card' ||
    'pokemonId' in value ||
    !isSlotContractId(value.cardId) ||
    ('language' in value && !isCardLanguage(value.language)) ||
    ('finish' in value && !isCardFinish(value.finish))
  )
    return undefined;
  return {
    kind: 'card',
    cardId: value.cardId,
    ...(isCardLanguage(value.language) ? { language: value.language } : {}),
    ...(isCardFinish(value.finish) ? { finish: value.finish } : {}),
  };
}

/** Recorded strings, not verified grades, numeric conversions or provider lookups. Assets are private IDs, not URLs. */
export function normalizeGradingRecord(value: unknown): GradingRecord | null | undefined {
  if (value === null) return null;
  if (
    !isContractRecord(value, [
      'provider',
      'grade',
      'scale',
      'designation',
      'subgrades',
      'certificate',
      'holder',
      'label',
    ])
  )
    return undefined;
  const p = value.provider,
    label = value.label;
  if (
    !isContractRecord(p, ['kind', 'id', 'name']) ||
    !nullableText(value.grade) ||
    !nullableText(value.scale) ||
    !nullableText(value.designation) ||
    !nullableText(value.certificate) ||
    !nullableText(value.holder) ||
    !Array.isArray(value.subgrades) ||
    value.subgrades.length > 20 ||
    !isContractRecord(label, ['variant', 'assetIds']) ||
    !nullableText(label.variant) ||
    !Array.isArray(label.assetIds) ||
    label.assetIds.length > 20 ||
    !Array.from(label.assetIds).every(isSlotContractId)
  )
    return undefined;
  let provider: GradingRecord['provider'];
  if (p.kind === 'known' && ['psa', 'ace', 'cgc', 'beckett'].includes(p.id as string) && !('name' in p)) {
    provider = { kind: 'known', id: p.id as Extract<GradingRecord['provider'], { kind: 'known' }>['id'] };
  } else if (p.kind === 'custom' && text(p.name) && !('id' in p)) provider = { kind: 'custom', name: p.name };
  else return undefined;
  const subgrades: GradingRecord['subgrades'] = [];
  for (const s of value.subgrades) {
    if (!isContractRecord(s, ['name', 'grade']) || !text(s.name) || !text(s.grade)) return undefined;
    subgrades.push({ name: s.name, grade: s.grade });
  }
  return {
    provider,
    grade: value.grade,
    scale: value.scale,
    designation: value.designation,
    certificate: value.certificate,
    holder: value.holder,
    subgrades,
    label: { variant: label.variant, assetIds: [...label.assetIds] as string[] },
  };
}

export function normalizeInventoryItem(value: unknown): InventoryItem | undefined {
  if (
    !isContractRecord(value, ['id', 'ownerUserId', 'identity', 'grading', 'acquiredAt', 'version']) ||
    !isSlotContractId(value.id) ||
    !isSlotContractId(value.ownerUserId) ||
    !isSlotRevision(value.version) ||
    (value.acquiredAt !== null &&
      (typeof value.acquiredAt !== 'string' || !Number.isFinite(Date.parse(value.acquiredAt))))
  )
    return undefined;
  const identity = normalizeInventoryIdentity(value.identity),
    grading = normalizeGradingRecord(value.grading);
  if (!identity || grading === undefined || (identity.kind === 'pokemon' && grading !== null)) return undefined;
  return {
    id: value.id,
    ownerUserId: value.ownerUserId,
    identity,
    grading,
    acquiredAt: value.acquiredAt,
    version: value.version,
  };
}

export function normalizeStorageCollection(value: unknown): StorageCollection | undefined {
  if (
    !isContractRecord(value, ['id', 'ownerUserId', 'name', 'kind', 'defaultPresentation', 'version', 'location']) ||
    !isSlotContractId(value.id) ||
    !isSlotContractId(value.ownerUserId) ||
    !text(value.name) ||
    !isSlotRevision(value.version) ||
    !['binder', 'slab', 'custom'].includes(value.kind as string) ||
    !['binder', 'slabs', 'list'].includes(value.defaultPresentation as string)
  )
    return undefined;
  if (
    'location' in value &&
    value.location !== null &&
    (value.kind !== 'custom' ||
      typeof value.location !== 'string' ||
      !value.location.length ||
      value.location.length > 200 ||
      value.location.trim() !== value.location)
  )
    return undefined;
  return {
    ...('location' in value ? { location: value.location as string | null } : {}),
    id: value.id,
    ownerUserId: value.ownerUserId,
    name: value.name,
    kind: value.kind as StorageKind,
    defaultPresentation: value.defaultPresentation as StoragePresentation,
    version: value.version,
  };
}

export function normalizePlacement(value: unknown): Placement | undefined {
  if (
    !isContractRecord(value, ['inventoryItemId', 'collectionId', 'slotId', 'version']) ||
    !isSlotContractId(value.inventoryItemId) ||
    !isSlotContractId(value.collectionId) ||
    !isSlotContractId(value.slotId) ||
    !isSlotRevision(value.version)
  )
    return undefined;
  return {
    inventoryItemId: value.inventoryItemId,
    collectionId: value.collectionId,
    slotId: value.slotId,
    version: value.version,
  };
}

/** Enforces a complete owner-wide bijection between occupied storage slots and primary placements. */
export function normalizeInventorySnapshot(value: unknown): InventorySnapshot | undefined {
  if (
    !isContractRecord(value, ['ownerUserId', 'inventoryRevision', 'items', 'placements', 'collections', 'binders']) ||
    !isSlotContractId(value.ownerUserId) ||
    !isSlotRevision(value.inventoryRevision) ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.placements) ||
    !Array.isArray(value.collections) ||
    !Array.isArray(value.binders)
  )
    return undefined;
  const items = Array.from(value.items, normalizeInventoryItem),
    placements = Array.from(value.placements, normalizePlacement);
  const collections = Array.from(value.collections, normalizeStorageCollection),
    binders = Array.from(value.binders, normalizeBinderSnapshot);
  if (
    items.some((i) => !i || i.ownerUserId !== value.ownerUserId) ||
    collections.some((c) => !c || c.ownerUserId !== value.ownerUserId) ||
    placements.some((p) => !p) ||
    binders.some((b) => !b || b.ownerUserId !== value.ownerUserId)
  )
    return undefined;
  const validItems = items as InventoryItem[],
    validCollections = collections as StorageCollection[],
    validBinders = binders as BinderSnapshot[],
    validPlacements = placements as Placement[];
  const itemIds = new Set(validItems.map((i) => i.id)),
    collectionIds = new Set(validCollections.map((c) => c.id));
  if (
    itemIds.size !== items.length ||
    collectionIds.size !== collections.length ||
    new Set(validBinders.map((b) => b.collectionId)).size !== binders.length ||
    binders.length !== collections.length ||
    validBinders.some((b) => !collectionIds.has(b.collectionId))
  )
    return undefined;
  const slots = validBinders.flatMap((b) => b.slots);
  const slotsById = new Map(slots.map((s) => [s.id, s]));
  if (
    slotsById.size !== slots.length ||
    new Set(validPlacements.map((p) => p.inventoryItemId)).size !== placements.length ||
    new Set(validPlacements.map((p) => p.slotId)).size !== placements.length
  )
    return undefined;
  for (const p of validPlacements) {
    const slot = slotsById.get(p.slotId);
    if (
      !itemIds.has(p.inventoryItemId) ||
      !slot ||
      slot.collectionId !== p.collectionId ||
      slot.inventoryItemId !== p.inventoryItemId
    )
      return undefined;
  }
  if (slots.filter((s) => s.inventoryItemId !== null).length !== placements.length) return undefined;
  return {
    ownerUserId: value.ownerUserId,
    inventoryRevision: value.inventoryRevision,
    items: validItems,
    placements: validPlacements,
    collections: validCollections,
    binders: validBinders,
  };
}

/** Resolver must use authoritative catalog evidence; this validates association, never authenticates its source. */
export function inventoryItemCandidate(
  item: InventoryItem,
  resolveCatalog: InventoryCatalogResolver,
): SlotTargetCandidate | undefined {
  if (item.identity.kind === 'pokemon') return { ...item.identity };
  const identity = item.identity,
    catalog = resolveCatalog(identity.cardId);
  if (!catalog || !matchesCatalogCardId(catalog, identity.cardId)) return undefined;
  return {
    kind: 'card',
    id: catalog.id,
    ...(catalog.canonicalId ? { canonicalId: catalog.canonicalId } : {}),
    ...(catalog.aliasIds ? { aliasIds: [...catalog.aliasIds] } : {}),
    pokemonIds: [...catalog.pokemonIds],
    ...(identity.language ? { language: identity.language } : {}),
    ...(identity.finish ? { finish: identity.finish } : {}),
  };
}

export function getInventoryItemLocation(
  snapshot: InventorySnapshot,
  inventoryItemId: string,
): Placement | null | undefined {
  if (!snapshot.items.some((i) => i.id === inventoryItemId)) return undefined;
  const placement = snapshot.placements.find((p) => p.inventoryItemId === inventoryItemId);
  return placement ? { ...placement } : null;
}

/** Valid complete snapshots only. Display references, wants and empty targets never enter these counts. */
export function getInventoryCounts(snapshot: InventorySnapshot) {
  const ids = new Set(snapshot.items.map((i) => i.id)),
    assigned = new Set(snapshot.placements.map((p) => p.inventoryItemId).filter((id) => ids.has(id)));
  const byCollection = Object.fromEntries(
    snapshot.collections.map((c) => [
      c.id,
      new Set(
        snapshot.placements
          .filter((p) => p.collectionId === c.id && ids.has(p.inventoryItemId))
          .map((p) => p.inventoryItemId),
      ).size,
    ]),
  );
  return { total: ids.size, assigned: assigned.size, unassigned: ids.size - assigned.size, byCollection };
}

/** Only primary storage placement can fulfill a target. A display reference is not a location. */
export function getStorageCompletion(
  snapshot: InventorySnapshot,
  collectionId: string,
  resolveCatalog: InventoryCatalogResolver,
) {
  const binder = snapshot.binders.find((b) => b.collectionId === collectionId);
  if (!binder) return undefined;
  return getBinderCompletion(binder, (id) => {
    const placement = snapshot.placements.find((p) => p.inventoryItemId === id && p.collectionId === collectionId);
    const item = snapshot.items.find((i) => i.id === id && i.ownerUserId === snapshot.ownerUserId);
    if (!placement || !item || !binder.slots.some((s) => s.id === placement.slotId && s.inventoryItemId === id))
      return undefined;
    return inventoryItemCandidate(item, resolveCatalog);
  });
}
