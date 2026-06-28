# Auto Refresh Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep two active binder editors in sync by polling the remote collection in the background.

**Architecture:** Reuse `useCollection` as the sync boundary. Extract a small polling guard for tests, expose the existing reload logic as a callable refresh function, then run it on an interval only when it is safe to replace local state.

**Tech Stack:** Next.js client components, React hooks, Supabase client, Bun test.

## Global Constraints

- Do not hard reload the browser page for normal sync.
- Do not refresh remote data while offline, read-only, logged out, or local pending operations exist.
- Keep the current binder page, filter, and modal state intact.
- Use the smallest relevant local checks before deploying.

---

### Task 1: Polling Guard

**Files:**
- Modify: `hooks/use-collection.ts`
- Test: `tests/use-collection-refresh.test.ts`

**Interfaces:**
- Produces: `shouldAutoRefreshCollection(input: { readOnly: boolean; hasUser: boolean; isOnline: boolean; pendingOperationCount: number; isFlushingPendingOperations: boolean }): boolean`

- [x] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test"
import { shouldAutoRefreshCollection } from "@/hooks/use-collection"

test("shouldAutoRefreshCollection only allows safe active editor refreshes", () => {
  expect(shouldAutoRefreshCollection({
    readOnly: false,
    hasUser: true,
    isOnline: true,
    pendingOperationCount: 0,
    isFlushingPendingOperations: false,
  })).toBe(true)

  expect(shouldAutoRefreshCollection({
    readOnly: false,
    hasUser: true,
    isOnline: true,
    pendingOperationCount: 1,
    isFlushingPendingOperations: false,
  })).toBe(false)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/use-collection-refresh.test.ts`
Expected: fail because `shouldAutoRefreshCollection` is not exported.

- [x] **Step 3: Write minimal implementation**

Add the exported guard to `hooks/use-collection.ts`.

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/use-collection-refresh.test.ts`
Expected: pass.

### Task 2: Collection Polling

**Files:**
- Modify: `hooks/use-collection.ts`

**Interfaces:**
- Consumes: `shouldAutoRefreshCollection(...)`
- Produces: background refresh every 5 seconds for safe active editor sessions.

- [x] **Step 1: Reuse existing remote reload logic**

Move the current mount reload body into `reloadRemoteCollection`.

- [x] **Step 2: Add interval effect**

Call `reloadRemoteCollection` every 5 seconds when `shouldAutoRefreshCollection` returns true.

- [x] **Step 3: Verify**

Run: `bun test tests/use-collection-refresh.test.ts && bun test && bun run lint`
Expected: all pass.
