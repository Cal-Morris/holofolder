import { isContractRecord, isSlotContractId, isSlotRevision } from '@/lib/domain/binder-slots';

export const CREATION_REJECTION_CODES = ['inventory_revision_conflict', 'creation_identity_conflict'] as const;
export const IMPORT_REJECTION_CODES = [
  'inventory_revision_conflict',
  'inventory_collection_conflict',
  'arrangement_destination_conflict',
  'import_copy_conflict',
] as const;
export interface CreationRejection {
  outcome: 'rejected';
  operationId: string;
  code: (typeof CREATION_REJECTION_CODES)[number];
  inventoryRevision: number;
}
export interface ImportRejection {
  outcome: 'rejected';
  operationId: string;
  code: (typeof IMPORT_REJECTION_CODES)[number];
  inventoryRevision: number;
}
/** Validate only a trusted executor result bound to the original request/scope. Not standalone client proof. */
function rejection(value: unknown, operationId: string, codes: readonly string[]): boolean {
  return (
    isSlotContractId(operationId) &&
    operationId.length >= 8 &&
    operationId.length <= 100 &&
    isContractRecord(value, ['outcome', 'operationId', 'code', 'inventoryRevision']) &&
    Object.keys(value).length === 4 &&
    value.outcome === 'rejected' &&
    value.operationId === operationId &&
    isSlotRevision(value.inventoryRevision) &&
    typeof value.code === 'string' &&
    codes.includes(value.code)
  );
}
export function isCreationRejection(value: unknown, operationId: string): value is CreationRejection {
  return rejection(value, operationId, CREATION_REJECTION_CODES);
}
export function isImportRejection(value: unknown, operationId: string): value is ImportRejection {
  return rejection(value, operationId, IMPORT_REJECTION_CODES);
}
