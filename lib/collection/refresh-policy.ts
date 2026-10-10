// When the collection hook may re-fetch the remote collection without clobbering local work.

/** Poll cadence while realtime is unavailable (the original behaviour). */
export const COLLECTION_AUTO_REFRESH_INTERVAL_MS = 5000
/** Safety-net poll while the realtime channel is subscribed and delivers changes itself. */
export const COLLECTION_REALTIME_SAFETY_REFRESH_INTERVAL_MS = 60_000

export interface ShouldAutoRefreshCollectionInput {
  readOnly: boolean
  hasUser: boolean
  isOnline: boolean
  pendingOperationCount: number
  isFlushingPendingOperations: boolean
  isWritingRemoteCollection: boolean
  /** Defaults to true. Hidden tabs never poll; they refresh when they become visible again. */
  isVisible?: boolean
}

export function keepStableUserById<TUser extends { id: string }>(currentUser: TUser | null, nextUser: TUser | null) {
  return currentUser?.id === nextUser?.id ? currentUser : nextUser
}

export function getResolvedCollectionOwner(userId: string | null, resolvedForUserId: string | null, ownerId: string | null) {
  return userId && userId === resolvedForUserId ? ownerId : null
}

export function getRemoteCollectionRefreshPlan<TUser extends { id: string }>(
  currentUser: TUser | null,
  knownOwnerUserId: string | null,
) {
  if (!currentUser) return null

  return {
    user: currentUser,
    knownOwnerUserId,
    shouldResolveOwner: !knownOwnerUserId,
  }
}

export function shouldAutoRefreshCollection(input: ShouldAutoRefreshCollectionInput) {
  return input.isVisible !== false &&
    !input.readOnly &&
    input.hasUser &&
    input.isOnline &&
    input.pendingOperationCount === 0 &&
    !input.isFlushingPendingOperations &&
    !input.isWritingRemoteCollection
}

export function getCollectionAutoRefreshIntervalMs(isRealtimeConnected: boolean) {
  return isRealtimeConnected ? COLLECTION_REALTIME_SAFETY_REFRESH_INTERVAL_MS : COLLECTION_AUTO_REFRESH_INTERVAL_MS
}

export function isCollectionAutoRefreshDue(input: {
  now: number
  lastRefreshAt: number
  isRealtimeConnected: boolean
}) {
  return input.now - input.lastRefreshAt >= getCollectionAutoRefreshIntervalMs(input.isRealtimeConnected)
}

export function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden"
}
