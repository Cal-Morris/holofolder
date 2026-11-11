import {
  isContractRecord,
  isSlotContractId,
  isSlotRevision,
  normalizeBinderSlot,
  normalizeSlotTarget,
} from '@/lib/domain/binder-slots';
import { normalizeGradingRecord, normalizeInventoryIdentity } from '@/lib/domain/inventory';
import type { GradingRecord, InventoryIdentity } from '@/lib/domain/inventory';
import type { InventorySelection } from '@/lib/inventory-plans';
import type { SlotPrecondition } from '@/lib/domain/slot-commands';
import type { SlotTarget } from '@/lib/domain/binder-slots';
import { isCardFinish, type CardFinish, type WantedCard } from '@/lib/domain/cards';

export interface InventorySlotRef {
  collectionId: string;
  slot: SlotPrecondition;
}
export interface InventoryItemRef {
  itemId: string;
  itemVersion: number;
  placement: InventorySlotRef | null;
}
export type PublicWantedCard = Omit<WantedCard, 'wanted_by' | 'card_image'>;
export type SelectedWant =
  { index: number; expected: WantedCard } | { index: number; expectedPublic: PublicWantedCard } | null;
/** Public fields only. Omission preserves; null clears nullable fields. Existing graded copies only. */
export type GradingPatch = Partial<
  Pick<GradingRecord, 'provider' | 'grade' | 'scale' | 'designation' | 'subgrades' | 'holder'>
> & { labelVariant?: string | null };
export function isGradingPatch(value: unknown): value is GradingPatch {
  if (
    !isContractRecord(value, ['provider', 'grade', 'scale', 'designation', 'subgrades', 'holder', 'labelVariant']) ||
    !Object.keys(value).length
  )
    return false;
  const { labelVariant, ...fields } = value;
  const probe = {
    provider: { kind: 'known', id: 'psa' },
    grade: null,
    scale: null,
    designation: null,
    subgrades: [],
    certificate: null,
    holder: null,
    ...fields,
    label: { variant: labelVariant === undefined ? null : labelVariant, assetIds: [] },
  };
  return normalizeGradingRecord(probe) !== undefined;
}
/** Explicit ownership choice; null creates only an empty slot/target. Never auto-selects a grade. */
export type InsertInventorySelection =
  | Extract<InventorySelection, { kind: 'existing' }>
  | {
      kind: 'new';
      itemId: string;
      identity: InventoryIdentity;
      grading: GradingRecord | null;
      acquiredAt: string | null;
    };
export interface InsertAssignCommand {
  kind: 'insertAssign';
  collectionId: string;
  slotId: string;
  before: SlotPrecondition | null;
  target: SlotTarget | null;
  selection: InsertInventorySelection | null;
}
export const INVENTORY_INSERT_LIMITS = { slots: 4096, work: 8192 } as const;
export type InventoryCommand =
  | InsertAssignCommand
  | {
      kind: 'add';
      itemId: string;
      identity: InventoryIdentity;
      grading: GradingRecord | null;
      acquiredAt: string | null;
    }
  | { kind: 'patchGrading'; item: InventoryItemRef; patch: GradingPatch }
  | { kind: 'edit'; item: InventoryItemRef; grading: GradingRecord | null }
  /** Correct a card copy's recorded finish in place (same copy, grading and history). */
  | { kind: 'setFinish'; item: InventoryItemRef; finish: CardFinish }
  | { kind: 'removeOwned' | 'unassign'; item: InventoryItemRef }
  | {
      kind: 'assign';
      selection: InventorySelection;
      destination: InventorySlotRef;
      occupied: 'cancel' | 'unassign';
      fulfillWant: SelectedWant;
    }
  | {
      kind: 'move';
      item: InventoryItemRef;
      destination: InventorySlotRef;
      occupied: 'cancel' | 'unassign' | 'swap';
      fulfillWant: SelectedWant;
    }
  | { kind: 'removeSlots'; slots: InventorySlotRef[] }
  | {
      kind: 'deleteCollection';
      collectionId: string;
      slots: SlotPrecondition[];
      replacementDefaultCollectionId: string | null;
      removeOwned?: true;
    };
export interface InventoryCommandRequest {
  operationId: string;
  inventoryRevision: number;
  collections: { collectionId: string; version: number; layoutRevision: number }[];
  commands: InventoryCommand[];
}
export const INVENTORY_LIMITS = {
  commands: 100,
  collections: 32,
  affected: 256,
  bytes: 262144,
  resultBytes: 1048576,
} as const;
export const INVENTORY_COLLECTION_DELETE_LIMITS = {
  slots: 4096,
  collections: 2,
  affected: 8192,
  bytes: 8388608,
  resultBytes: 16777216,
} as const;
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const exact = (v: unknown, keys: string[]) => isContractRecord(v, keys) && Object.keys(v).length === keys.length;
const ref = (v: unknown): v is SlotPrecondition =>
  isContractRecord(v, ['id', 'version', 'inventoryItemId', 'itemVersion', 'placementVersion']) &&
  exact(v, ['id', 'version', 'inventoryItemId', 'itemVersion', 'placementVersion']) &&
  isSlotContractId(v.id) &&
  isSlotRevision(v.version) &&
  (v.inventoryItemId === null
    ? v.itemVersion === null && v.placementVersion === null
    : isSlotContractId(v.inventoryItemId) && isSlotRevision(v.itemVersion) && isSlotRevision(v.placementVersion));
const slot = (v: unknown): v is InventorySlotRef =>
  isContractRecord(v, ['collectionId', 'slot']) && uuid(v.collectionId) && ref(v.slot);
const item = (v: unknown): v is InventoryItemRef =>
  isContractRecord(v, ['itemId', 'itemVersion', 'placement']) &&
  isSlotContractId(v.itemId) &&
  isSlotRevision(v.itemVersion) &&
  (v.placement === null ||
    (slot(v.placement) &&
      v.placement.slot.inventoryItemId === v.itemId &&
      v.placement.slot.itemVersion === v.itemVersion));
function invalid(): never {
  throw new Error('Invalid or oversized inventory command');
}

/** Body contains intent/preconditions only, never actor, owner, source or catalog evidence. */
export function parseInventoryCommand(value: unknown): InventoryCommandRequest {
  const wholeCollection =
    isContractRecord(value, ['operationId', 'inventoryRevision', 'collections', 'commands']) &&
    Array.isArray(value.commands) &&
    value.commands.length === 1 &&
    isContractRecord(value.commands[0], [
      'kind',
      'collectionId',
      'slots',
      'replacementDefaultCollectionId',
      'removeOwned',
    ]) &&
    value.commands[0].kind === 'deleteCollection';
  const limits = wholeCollection ? INVENTORY_COLLECTION_DELETE_LIMITS : INVENTORY_LIMITS;
  if (
    new TextEncoder().encode(JSON.stringify(value) ?? '').length > limits.bytes ||
    !isContractRecord(value, ['operationId', 'inventoryRevision', 'collections', 'commands']) ||
    !isSlotContractId(value.operationId) ||
    value.operationId.length < 8 ||
    value.operationId.length > 100 ||
    !isSlotRevision(value.inventoryRevision) ||
    !Array.isArray(value.collections) ||
    value.collections.length > limits.collections ||
    !Array.isArray(value.commands) ||
    !value.commands.length ||
    value.commands.length > INVENTORY_LIMITS.commands
  )
    return invalid();
  const collections = new Set<string>();
  for (const c of value.collections) {
    if (
      !isContractRecord(c, ['collectionId', 'version', 'layoutRevision']) ||
      !uuid(c.collectionId) ||
      !isSlotRevision(c.version) ||
      !isSlotRevision(c.layoutRevision) ||
      collections.has(c.collectionId)
    )
      return invalid();
    collections.add(c.collectionId);
  }
  let affected = 0;
  const checkSlot = (s: unknown) => slot(s) && collections.has(s.collectionId);
  const checkItem = (i: unknown) => item(i) && (i.placement === null || checkSlot(i.placement));
  for (const c of value.commands) {
    if (
      !isContractRecord(c, [
        'kind',
        'itemId',
        'identity',
        'grading',
        'acquiredAt',
        'item',
        'selection',
        'destination',
        'occupied',
        'fulfillWant',
        'slots',
        'collectionId',
        'replacementDefaultCollectionId',
        'removeOwned',
        'patch',
        'slotId',
        'before',
        'target',
        'finish',
      ])
    )
      return invalid();
    if (c.kind === 'insertAssign') {
      affected += 2;
      if (
        !exact(c, ['kind', 'collectionId', 'slotId', 'before', 'target', 'selection']) ||
        !uuid(c.collectionId) ||
        !collections.has(c.collectionId) ||
        !isSlotContractId(c.slotId) ||
        (c.before !== null && !ref(c.before)) ||
        normalizeSlotTarget(c.target) === undefined
      )
        return invalid();
      const selection = c.selection;
      if (selection !== null) {
        if (
          !isContractRecord(selection, [
            'kind',
            'inventoryItemId',
            'itemVersion',
            'itemId',
            'identity',
            'grading',
            'acquiredAt',
          ])
        )
          return invalid();
        if (selection.kind === 'existing') {
          if (
            !exact(selection, ['kind', 'inventoryItemId', 'itemVersion']) ||
            !isSlotContractId(selection.inventoryItemId) ||
            !isSlotRevision(selection.itemVersion)
          )
            return invalid();
        } else if (selection.kind === 'new') {
          if (!exact(selection, ['kind', 'itemId', 'identity', 'grading', 'acquiredAt'])) return invalid();
          parseInventoryCommand({
            operationId: value.operationId,
            inventoryRevision: value.inventoryRevision,
            collections: [],
            commands: [{ ...selection, kind: 'add' }],
          });
        } else return invalid();
      }
    } else if (c.kind === 'add') {
      affected += 2;
      const identity = normalizeInventoryIdentity(c.identity);
      if (
        !exact(c, ['kind', 'itemId', 'identity', 'grading', 'acquiredAt']) ||
        !isSlotContractId(c.itemId) ||
        !identity ||
        normalizeGradingRecord(c.grading) === undefined ||
        (identity.kind === 'pokemon' && c.grading !== null) ||
        (c.acquiredAt !== null && (typeof c.acquiredAt !== 'string' || !Number.isFinite(Date.parse(c.acquiredAt))))
      )
        return invalid();
    } else if (c.kind === 'setFinish') {
      affected += 2;
      if (!exact(c, ['kind', 'item', 'finish']) || !checkItem(c.item) || !isCardFinish(c.finish)) return invalid();
    } else if (c.kind === 'patchGrading') {
      affected += 2;
      if (!exact(c, ['kind', 'item', 'patch']) || !checkItem(c.item) || !isGradingPatch(c.patch)) return invalid();
    } else if (c.kind === 'edit' || c.kind === 'removeOwned' || c.kind === 'unassign') {
      affected += 2;
      if (
        !exact(c, c.kind === 'edit' ? ['kind', 'item', 'grading'] : ['kind', 'item']) ||
        !checkItem(c.item) ||
        (c.kind === 'edit' && normalizeGradingRecord(c.grading) === undefined)
      )
        return invalid();
    } else if (c.kind === 'move' || c.kind === 'assign') {
      if (
        !exact(
          c,
          c.kind === 'move'
            ? ['kind', 'item', 'destination', 'occupied', 'fulfillWant']
            : ['kind', 'selection', 'destination', 'occupied', 'fulfillWant'],
        ) ||
        !checkSlot(c.destination) ||
        !(c.kind === 'move' ? ['cancel', 'unassign', 'swap'] : ['cancel', 'unassign']).includes(c.occupied as string)
      )
        return invalid();
      affected +=
        (c.kind === 'move' ? 3 : 2) + ((c.destination as InventorySlotRef).slot.inventoryItemId === null ? 0 : 1);
      if (c.kind === 'move') {
        if (!checkItem(c.item) || (c.item as InventoryItemRef).placement === null) return invalid();
      } else {
        const s = c.selection;
        if (!isContractRecord(s, ['kind', 'identity', 'newItemId', 'inventoryItemId', 'itemVersion'])) return invalid();
        if (s.kind === 'existing') {
          if (
            !exact(s, ['kind', 'inventoryItemId', 'itemVersion']) ||
            !isSlotContractId(s.inventoryItemId) ||
            !isSlotRevision(s.itemVersion)
          )
            return invalid();
        } else if (
          s.kind !== 'catalog' ||
          !exact(s, ['kind', 'identity', 'newItemId']) ||
          normalizeInventoryIdentity(s.identity)?.kind !== 'card' ||
          !isSlotContractId(s.newItemId)
        )
          return invalid();
      }
      if (c.fulfillWant !== null) {
        if (
          !isContractRecord(c.fulfillWant, ['index', 'expected', 'expectedPublic']) ||
          !isSlotRevision(c.fulfillWant.index) ||
          c.fulfillWant.index >= 100
        )
          return invalid();
        const publicOnly = 'expectedPublic' in c.fulfillWant;
        if (!exact(c.fulfillWant, ['index', publicOnly ? 'expectedPublic' : 'expected'])) return invalid();
        const expected = publicOnly ? c.fulfillWant.expectedPublic : c.fulfillWant.expected;
        if (
          publicOnly &&
          !isContractRecord(expected, [
            'card_id',
            'card_name',
            'added_at',
            'card_language',
            'card_finish',
            'card_set',
            'rarity',
            'local_id',
            'illustrator',
            'set_total',
          ])
        )
          return invalid();
        if (
          !normalizeBinderSlot({
            id: 'validation',
            ownerUserId: 'validation',
            collectionId: 'validation',
            target: null,
            inventoryItemId: null,
            wantedCards: [expected],
            status: null,
            version: 0,
            presetOrigin: null,
          })
        )
          return invalid();
      }
    } else if (c.kind === 'removeSlots') {
      if (!exact(c, ['kind', 'slots']) || !Array.isArray(c.slots) || !c.slots.length || !c.slots.every(checkSlot))
        return invalid();
      affected += c.slots.length + c.slots.filter((s: InventorySlotRef) => s.slot.inventoryItemId !== null).length;
    } else if (c.kind === 'deleteCollection') {
      if (
        !(
          exact(c, ['kind', 'collectionId', 'slots', 'replacementDefaultCollectionId']) ||
          (exact(c, ['kind', 'collectionId', 'slots', 'replacementDefaultCollectionId', 'removeOwned']) &&
            c.removeOwned === true)
        ) ||
        !uuid(c.collectionId) ||
        !collections.has(c.collectionId) ||
        !Array.isArray(c.slots) ||
        c.slots.length > INVENTORY_COLLECTION_DELETE_LIMITS.slots ||
        !c.slots.every(ref) ||
        !(
          c.replacementDefaultCollectionId === null ||
          (uuid(c.replacementDefaultCollectionId) &&
            collections.has(c.replacementDefaultCollectionId) &&
            c.replacementDefaultCollectionId !== c.collectionId)
        )
      )
        return invalid();
      affected +=
        Math.max(1, c.slots.length) + c.slots.filter((s: SlotPrecondition) => s.inventoryItemId !== null).length;
    } else return invalid();
  }
  if (affected > limits.affected) return invalid();
  return structuredClone(value) as unknown as InventoryCommandRequest;
}
