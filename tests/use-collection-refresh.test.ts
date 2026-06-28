import test from "node:test"
import assert from "node:assert/strict"
import { shouldAutoRefreshCollection } from "../hooks/use-collection"

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
