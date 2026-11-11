export const COLLECTION_CHANGED_EVENT = 'collection_changed';

export interface CollectionChangedPayload {
  changedAt: string;
}

export function getCollectionRealtimeTopic(ownerUserId: string) {
  const normalizedOwnerUserId = ownerUserId.trim();

  if (!normalizedOwnerUserId) {
    throw new Error('Collection owner user id is required');
  }

  return `collection:${normalizedOwnerUserId}`;
}

export function createCollectionChangedPayload(changedAt = new Date().toISOString()): CollectionChangedPayload {
  return { changedAt };
}
