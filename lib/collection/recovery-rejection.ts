import { isContractRecord, isSlotRevision } from '@/lib/domain/binder-slots';

export const RECOVERY_REJECTION_CODES = ['recovery_plan_conflict', 'recovery_dependency_conflict'] as const;
export interface RecoveryRejection {
  outcome: 'rejected';
  operationId: string;
  code: (typeof RECOVERY_REJECTION_CODES)[number];
  inventoryRevision: number;
}
/** Only migration 092's committed recovery result, never SQL or HTTP error classification. */
export function isRecoveryRejection(value: unknown, operationId: string): value is RecoveryRejection {
  return (
    isContractRecord(value, ['outcome', 'operationId', 'code', 'inventoryRevision']) &&
    Object.keys(value).length === 4 &&
    value.outcome === 'rejected' &&
    value.operationId === operationId &&
    isSlotRevision(value.inventoryRevision) &&
    RECOVERY_REJECTION_CODES.includes(value.code as RecoveryRejection['code'])
  );
}
export function recoveryUnresolved(value: { synchronized: boolean; resolution?: 'discarded' | null }) {
  return !value.synchronized && value.resolution !== 'discarded';
}
