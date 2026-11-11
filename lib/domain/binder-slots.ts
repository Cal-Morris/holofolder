import { normalizePresetManifest, type PresetManifest, type PresetSource } from '@/lib/domain/binder-presets';
import { matchesCatalogCardId } from '@/lib/card-catalog';
import {
  isCardFinish,
  isCardLanguage,
  isSlotStatus,
  normalizeWantedPeople,
  type CardCatalogIdentity,
  type CardFinish,
  type CardLanguage,
  type SlotStatus,
  type WantedCard,
} from '@/lib/domain/cards';

export type SlotTarget =
  | { kind: 'pokemon'; pokemonId: number }
  | { kind: 'card'; cardId: string; language?: CardLanguage; finish?: CardFinish };

/** Identity evidence supplied by the catalog or an inventory adapter, never inferred from a card name. */
export type SlotTargetCandidate =
  | (CardCatalogIdentity & {
      kind: 'card';
      id: string;
      pokemonIds: readonly number[];
      language?: CardLanguage;
      finish?: CardFinish;
    })
  | { kind: 'pokemon'; pokemonId: number };

/** Null is intentionally free; undefined rejects malformed input instead of removing a constraint. */
export function normalizeSlotTarget(value: unknown): SlotTarget | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const target = value as Record<string, unknown>;
  if (target.kind === 'pokemon') {
    if (Object.keys(target).some((key) => key !== 'kind' && key !== 'pokemonId')) return undefined;
    if (typeof target.pokemonId !== 'number' || !Number.isSafeInteger(target.pokemonId) || target.pokemonId <= 0)
      return undefined;
    return { kind: 'pokemon', pokemonId: target.pokemonId };
  }
  if (target.kind !== 'card') return undefined;
  if (Object.keys(target).some((key) => !['kind', 'cardId', 'language', 'finish'].includes(key))) return undefined;
  if (
    typeof target.cardId !== 'string' ||
    !target.cardId ||
    target.cardId !== target.cardId.trim() ||
    target.cardId.length > 200
  )
    return undefined;
  if ('language' in target && !isCardLanguage(target.language)) return undefined;
  if ('finish' in target && !isCardFinish(target.finish)) return undefined;
  return {
    kind: 'card',
    cardId: target.cardId,
    ...(isCardLanguage(target.language) ? { language: target.language } : {}),
    ...(isCardFinish(target.finish) ? { finish: target.finish } : {}),
  };
}

/** Inputs must already be validated. Matching never changes ownership or satisfies another slot. */
export function matchesSlotTarget(candidate: SlotTargetCandidate, target: SlotTarget | null): boolean {
  if (target === null) return true;
  if (target.kind === 'pokemon') {
    return candidate.kind === 'pokemon'
      ? candidate.pokemonId === target.pokemonId
      : candidate.pokemonIds.includes(target.pokemonId);
  }
  if (candidate.kind !== 'card' || !matchesCatalogCardId(candidate, target.cardId)) return false;
  return (
    (target.language === undefined || target.language === candidate.language) &&
    (target.finish === undefined || target.finish === candidate.finish)
  );
}

/** A storage slot carries references, never an owned-copy/card/grading payload. */
export interface BinderSlot {
  id: string;
  ownerUserId: string;
  collectionId: string;
  target: SlotTarget | null;
  inventoryItemId: string | null;
  wantedCards: WantedCard[];
  status: SlotStatus | null;
  version: number;
  presetOrigin: { source: PresetSource; entryId: string } | null;
}

export interface BinderSnapshot {
  ownerUserId: string;
  collectionId: string;
  layoutRevision: number;
  slots: BinderSlot[];
  presetManifest: PresetManifest | null;
}

/** IDs are opaque at this layer, including guest/offline IDs; adapters validate persisted UUIDs. */
export function isSlotContractId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value;
}

export function isSlotRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isContractRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function normalizeSlotWant(value: unknown): WantedCard | undefined {
  const strings = ['card_image', 'card_set', 'rarity', 'local_id', 'illustrator'] as const;
  if (
    !isContractRecord(value, [
      'card_id',
      'card_name',
      'added_at',
      'card_language',
      'card_finish',
      'set_total',
      'wanted_by',
      ...strings,
    ])
  )
    return undefined;
  if (
    !isSlotContractId(value.card_id) ||
    typeof value.card_name !== 'string' ||
    !value.card_name.trim() ||
    typeof value.added_at !== 'string' ||
    !Number.isFinite(Date.parse(value.added_at))
  )
    return undefined;
  if (strings.some((key) => key in value && typeof value[key] !== 'string')) return undefined;
  if ('card_language' in value && !isCardLanguage(value.card_language)) return undefined;
  if ('card_finish' in value && !isCardFinish(value.card_finish)) return undefined;
  if ('set_total' in value && (!isSlotRevision(value.set_total) || value.set_total === 0)) return undefined;
  if ('wanted_by' in value) {
    const people = normalizeWantedPeople(value.wanted_by);
    if (!Array.isArray(value.wanted_by) || !people || people.length !== value.wanted_by.length) return undefined;
  }
  return {
    card_id: value.card_id,
    card_name: value.card_name,
    added_at: value.added_at,
    ...Object.fromEntries(strings.filter((key) => key in value).map((key) => [key, value[key]])),
    ...(isCardLanguage(value.card_language) ? { card_language: value.card_language } : {}),
    ...(isCardFinish(value.card_finish) ? { card_finish: value.card_finish } : {}),
    ...(typeof value.set_total === 'number' ? { set_total: value.set_total } : {}),
    ...('wanted_by' in value ? { wanted_by: normalizeWantedPeople(value.wanted_by)! } : {}),
  };
}

/** Invalid fields fail the entire slot; normalization never drops contents or removes a target. */
export function normalizeBinderSlot(value: unknown): BinderSlot | undefined {
  if (
    !isContractRecord(value, [
      'id',
      'ownerUserId',
      'collectionId',
      'target',
      'inventoryItemId',
      'wantedCards',
      'status',
      'version',
      'presetOrigin',
    ])
  )
    return undefined;
  if (
    !isSlotContractId(value.id) ||
    !isSlotContractId(value.ownerUserId) ||
    !isSlotContractId(value.collectionId) ||
    !isSlotRevision(value.version) ||
    !Array.isArray(value.wantedCards)
  )
    return undefined;
  const target = normalizeSlotTarget(value.target);
  if (target === undefined || (value.inventoryItemId !== null && !isSlotContractId(value.inventoryItemId)))
    return undefined;
  if (value.status !== null && !isSlotStatus(value.status)) return undefined;
  const owned = value.status === 'collected' || value.status === 'finalized';
  if (owned !== (value.inventoryItemId !== null)) return undefined;
  const wants = Array.from(value.wantedCards, normalizeSlotWant);
  if (wants.some((want) => want === undefined)) return undefined;
  let presetOrigin: BinderSlot['presetOrigin'] = null;
  if (value.presetOrigin !== null) {
    const origin = value.presetOrigin;
    if (
      !isContractRecord(origin, ['source', 'entryId']) ||
      !isSlotContractId(origin.entryId) ||
      !isContractRecord(origin.source, ['id', 'version']) ||
      !isSlotContractId(origin.source.id) ||
      !isSlotContractId(origin.source.version)
    )
      return undefined;
    presetOrigin = { source: { id: origin.source.id, version: origin.source.version }, entryId: origin.entryId };
  }
  return {
    id: value.id,
    ownerUserId: value.ownerUserId,
    collectionId: value.collectionId,
    target,
    inventoryItemId: value.inventoryItemId,
    wantedCards: wants as WantedCard[],
    status: value.status,
    version: value.version,
    presetOrigin,
  };
}

/** All-or-nothing snapshot validation, including scope and local placement uniqueness. */
export function normalizeBinderSnapshot(value: unknown): BinderSnapshot | undefined {
  if (!isContractRecord(value, ['ownerUserId', 'collectionId', 'layoutRevision', 'slots', 'presetManifest']))
    return undefined;
  if (
    !isSlotContractId(value.ownerUserId) ||
    !isSlotContractId(value.collectionId) ||
    !isSlotRevision(value.layoutRevision) ||
    !Array.isArray(value.slots)
  )
    return undefined;
  const presetManifest = value.presetManifest === null ? null : normalizePresetManifest(value.presetManifest);
  if (presetManifest === undefined) return undefined;
  const slots: BinderSlot[] = [];
  const ids = new Set<string>();
  const items = new Set<string>();
  for (const raw of value.slots) {
    const slot = normalizeBinderSlot(raw);
    if (!slot || slot.ownerUserId !== value.ownerUserId || slot.collectionId !== value.collectionId || ids.has(slot.id))
      return undefined;
    if (slot.inventoryItemId !== null) {
      if (items.has(slot.inventoryItemId)) return undefined;
      items.add(slot.inventoryItemId);
    }
    if (
      slot.presetOrigin &&
      (!presetManifest ||
        slot.presetOrigin.source.id !== presetManifest.source.id ||
        slot.presetOrigin.source.version !== presetManifest.source.version ||
        !presetManifest.entries.some((entry) => entry.id === slot.presetOrigin!.entryId))
    )
      return undefined;
    ids.add(slot.id);
    slots.push(slot);
  }
  return {
    ownerUserId: value.ownerUserId,
    collectionId: value.collectionId,
    layoutRevision: value.layoutRevision,
    slots,
    presetManifest,
  };
}

/** The caller must resolve this slot's actual item, with trusted catalog evidence. */
export function canChangeSlotTarget(
  slot: BinderSlot,
  target: SlotTarget | null,
  candidate?: SlotTargetCandidate,
): boolean {
  return (
    slot.inventoryItemId === null ||
    target === null ||
    (candidate !== undefined && matchesSlotTarget(candidate, target))
  );
}

/** Missing inventory/catalog evidence is unknown, never presumed completion. */
export function getBinderCompletion(
  snapshot: BinderSnapshot,
  resolveItem: (inventoryItemId: string) => SlotTargetCandidate | undefined,
) {
  let targetCount = 0;
  let completedTargetCount = 0;
  for (const slot of snapshot.slots) {
    if (slot.target === null) continue;
    targetCount++;
    const candidate = slot.inventoryItemId === null ? undefined : resolveItem(slot.inventoryItemId);
    if (candidate && matchesSlotTarget(candidate, slot.target)) completedTargetCount++;
  }
  return { targetCount, completedTargetCount };
}
