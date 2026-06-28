# Realtime Collection Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make other active binder screens refresh immediately after collection changes and ensure wanted-card summaries show the specific wanted card.

**Architecture:** Keep `useCollection` as the collection sync boundary. Add tiny pure helpers for wanted-card display and realtime broadcast naming, then wire a Supabase Broadcast channel per collection owner with 5s polling as fallback.

**Tech Stack:** Next.js client components, React hooks, Supabase Realtime Broadcast, Bun test.

## Global Constraints

- Do not touch unrelated dirty files in the main checkout.
- Keep polling as a fallback for missed realtime messages.
- Do not hard reload the browser page.
- Wanted-card UI must prefer `wanted_cards[0]` over owned-card fields when rendering wanted state.
- Use public client broadcast only for invalidation signals, no card data in realtime payloads.

---

### Task 1: Wanted Card Display Helpers

**Files:**
- Create: `lib/collection-display.ts`
- Create: `tests/collection-display.test.ts`
- Modify: `components/binder-app.tsx`

**Interfaces:**
- Produces: `getWantedCardPreview(item)`, `getWantedDisplayCard(item, fallbackPokemonName)`.

- [x] **Step 1: Write failing tests**
- [x] **Step 2: Run `bun test tests/collection-display.test.ts` and confirm missing module failure**
- [x] **Step 3: Add the helper implementation**
- [x] **Step 4: Update binder display surfaces to use the helper**
- [x] **Step 5: Run helper tests and touched-file lint**

### Task 2: Realtime Collection Invalidation

**Files:**
- Create: `lib/collection-realtime.ts`
- Create: `tests/collection-realtime.test.ts`
- Modify: `hooks/use-collection.ts`

**Interfaces:**
- Produces: `getCollectionRealtimeTopic(ownerUserId)`, `COLLECTION_CHANGED_EVENT`.
- Consumes: Supabase channel `.on("broadcast", { event }, handler).subscribe()` and `.send({ type: "broadcast", event, payload })`.

- [x] **Step 1: Write failing tests for topic and payload helpers**
- [x] **Step 2: Run `bun test tests/collection-realtime.test.ts` and confirm missing module failure**
- [x] **Step 3: Add realtime helper implementation**
- [x] **Step 4: Subscribe in `useCollection` and call `reloadRemoteCollection` on broadcasts**
- [x] **Step 5: Broadcast after successful remote writes and pending-op flushes**
- [x] **Step 6: Run `bun test`, touched-file lint, and `bun run build`**
