import test from "node:test"
import assert from "node:assert/strict"
import {
  COLLECTION_AUTO_REFRESH_INTERVAL_MS,
  COLLECTION_REALTIME_SAFETY_REFRESH_INTERVAL_MS,
  getCollectionAutoRefreshIntervalMs,
  getRemoteCollectionRefreshPlan,
  isCollectionAutoRefreshDue,
  keepStableUserById,
  shouldAutoRefreshCollection,
} from "../hooks/use-collection"

test("shouldAutoRefreshCollection allows refreshes for safe active editor sessions", () => {
  assert.equal(shouldAutoRefreshCollection({
    readOnly: false,
    hasUser: true,
    isOnline: true,
    pendingOperationCount: 0,
    isFlushingPendingOperations: false,
    isWritingRemoteCollection: false,
  }), true)
})

test("shouldAutoRefreshCollection blocks refreshes that could overwrite local work", () => {
  assert.equal(shouldAutoRefreshCollection({
    readOnly: true,
    hasUser: true,
    isOnline: true,
    pendingOperationCount: 0,
    isFlushingPendingOperations: false,
    isWritingRemoteCollection: false,
  }), false)

  assert.equal(shouldAutoRefreshCollection({
    readOnly: false,
    hasUser: false,
    isOnline: true,
    pendingOperationCount: 0,
    isFlushingPendingOperations: false,
    isWritingRemoteCollection: false,
  }), false)

  assert.equal(shouldAutoRefreshCollection({
    readOnly: false,
    hasUser: true,
    isOnline: false,
    pendingOperationCount: 0,
    isFlushingPendingOperations: false,
    isWritingRemoteCollection: false,
  }), false)

  assert.equal(shouldAutoRefreshCollection({
    readOnly: false,
    hasUser: true,
    isOnline: true,
    pendingOperationCount: 1,
    isFlushingPendingOperations: false,
    isWritingRemoteCollection: false,
  }), false)

  assert.equal(shouldAutoRefreshCollection({
    readOnly: false,
    hasUser: true,
    isOnline: true,
    pendingOperationCount: 0,
    isFlushingPendingOperations: true,
    isWritingRemoteCollection: false,
  }), false)

  assert.equal(shouldAutoRefreshCollection({
    readOnly: false,
    hasUser: true,
    isOnline: true,
    pendingOperationCount: 0,
    isFlushingPendingOperations: false,
    isWritingRemoteCollection: true,
  }), false)
})

test("keepStableUserById preserves the current user object when only the session object refreshed", () => {
  const currentUser = { id: "user-1", email: "one@example.com" }

  assert.equal(keepStableUserById(currentUser, { id: "user-1", email: "new-object@example.com" }), currentUser)
  assert.deepEqual(keepStableUserById(currentUser, { id: "user-2", email: "two@example.com" }), {
    id: "user-2",
    email: "two@example.com",
  })
  assert.equal(keepStableUserById(currentUser, null), null)
})

test("getRemoteCollectionRefreshPlan reuses known auth and owner state for polling", () => {
  const currentUser = { id: "user-1" }

  assert.equal(getRemoteCollectionRefreshPlan(null, "owner-1"), null)
  assert.deepEqual(getRemoteCollectionRefreshPlan(currentUser, "owner-1"), {
    user: currentUser,
    knownOwnerUserId: "owner-1",
    shouldResolveOwner: false,
  })
  assert.deepEqual(getRemoteCollectionRefreshPlan(currentUser, null), {
    user: currentUser,
    knownOwnerUserId: null,
    shouldResolveOwner: true,
  })
})

test("shouldAutoRefreshCollection never polls hidden tabs", () => {
  const base = {
    readOnly: false,
    hasUser: true,
    isOnline: true,
    pendingOperationCount: 0,
    isFlushingPendingOperations: false,
    isWritingRemoteCollection: false,
  }

  assert.equal(shouldAutoRefreshCollection({ ...base, isVisible: false }), false)
  assert.equal(shouldAutoRefreshCollection({ ...base, isVisible: true }), true)
  assert.equal(shouldAutoRefreshCollection(base), true)
})

test("collection polling backs off to a safety net while realtime is connected", () => {
  assert.equal(getCollectionAutoRefreshIntervalMs(false), COLLECTION_AUTO_REFRESH_INTERVAL_MS)
  assert.equal(getCollectionAutoRefreshIntervalMs(true), COLLECTION_REALTIME_SAFETY_REFRESH_INTERVAL_MS)
  assert.equal(COLLECTION_AUTO_REFRESH_INTERVAL_MS, 5000)
  assert.equal(COLLECTION_REALTIME_SAFETY_REFRESH_INTERVAL_MS, 60_000)

  assert.equal(isCollectionAutoRefreshDue({ now: 5_000, lastRefreshAt: 0, isRealtimeConnected: false }), true)
  assert.equal(isCollectionAutoRefreshDue({ now: 4_999, lastRefreshAt: 0, isRealtimeConnected: false }), false)
  assert.equal(isCollectionAutoRefreshDue({ now: 30_000, lastRefreshAt: 0, isRealtimeConnected: true }), false)
  assert.equal(isCollectionAutoRefreshDue({ now: 60_000, lastRefreshAt: 0, isRealtimeConnected: true }), true)
})

test('keepStableUserById replaces stale bootstrap metadata with the current session profile', () => {
  const bootstrap = { id: 'user-1', user_metadata: { display_name: 'Old name' } }
  const session = { id: 'user-1', user_metadata: { display_name: 'Cal Morris' } }
  assert.equal(keepStableUserById(bootstrap, session), session)
  assert.equal(keepStableUserById(session, { ...session, user_metadata: { ...session.user_metadata } }), session)
})
