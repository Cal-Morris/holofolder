import test from "node:test"
import assert from "node:assert/strict"
import {
  getRemoteCollectionRefreshPlan,
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
