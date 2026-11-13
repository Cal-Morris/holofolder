import { isSlotContractId, isSlotRevision } from '@/lib/domain/binder-slots';
import { SLOT_LIMITS } from '@/lib/domain/slot-commands';
export { parseSlotCommand } from '@/lib/domain/slot-commands';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function invalid(): never {
  throw new Error('Invalid or oversized slot command');
}

export interface SlotPageInput {
  actorId: string;
  ownerUserId: string;
  collectionId: string;
  limit: number;
  afterPosition?: number;
  inventoryRevision?: number;
  collectionVersion?: number;
  layoutRevision?: number;
}
export type { SlotPage } from '@/lib/domain/slot-commands';
import type { SlotPage } from '@/lib/domain/slot-commands';
/** Internal transport-independent adapter. Reader is a trusted RPC binding, never supplied by HTTP. */
export async function readSlotPage(
  reader: (input: SlotPageInput) => Promise<SlotPage>,
  input: SlotPageInput,
): Promise<SlotPage> {
  if (
    !uuid(input.collectionId) ||
    !isSlotContractId(input.actorId) ||
    !isSlotContractId(input.ownerUserId) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > SLOT_LIMITS.page ||
    (input.afterPosition !== undefined && !isSlotRevision(input.afterPosition)) ||
    ([input.afterPosition, input.inventoryRevision, input.collectionVersion, input.layoutRevision].some(
      (v) => v !== undefined,
    ) &&
      ![input.inventoryRevision, input.collectionVersion, input.layoutRevision].every(isSlotRevision))
  )
    invalid();
  return reader(input);
}
