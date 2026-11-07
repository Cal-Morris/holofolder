---
name: offline-and-caching
description: Change holofolder offline behaviour, including the service worker (public/sw.js), the static offline app shell, the IndexedDB offline store, the localStorage collection snapshot and offline write queue, and cache warm-up. Use when touching caching, sync or anything that must work without network.
---

# Offline and caching

## Pieces

- **`public/sw.js`**
  - Caches: `binderdex-v4-shell`, `binderdex-v4-data` and `binderdex-v3-images` (the image cache name is kept so cached cards survive upgrades).
  - Navigations are network-first. On failure, or after 6 s on `/` and `/app-shell`, they're served `/app-shell`. `/auth/*` and `/share/*` never get the shell. **Per-user HTML is never cached.**
  - The shell and the JS, CSS and fonts it references are precached and only swapped in once complete. Lazy chunks named inside the shell's scripts are precached too, under both `static/chunks/` and Vercel's `static/immutable/chunks/`.
  - Card data (`tcgdex-cache`, `tcg-set-slots`, `tcg-card-search`) is network-first, with a 5 s cache fallback when a copy exists.
  - Images are cache-first, capped at 1,500 entries with the oldest evicted first.
  - Warm-up handles up to 500 URLs, 4 at a time (`BINDERDEX_WARM_CACHE` message).
- **`app/app-shell/` and `components/offline-app-shell.tsx`**: a static shell that boots `BinderApp` from on-device data only (session from the cookie, collection snapshot, stored settings). The pure logic is in `lib/offline-shell.ts`.
- **`lib/collection/offline-queue.ts`**:
  - The localStorage snapshot `pokemon_collection_snapshot_v1` and pending ops `pokemon_collection_pending_ops_v1`. localStorage is the synchronous first read.
  - Snapshots and queued ops carry a `binderId`. A snapshot is only applied to the binder it was saved for, and queued ops flush to their own binder (ops without one go to the default binder). Switching binders needs a connection for now.
  - `hooks/use-collection.ts` flushes the queue when online, and polls or listens via Realtime.
- **`lib/collection/sync.ts`**: the conflict model for queued writes.
  - Each edit stores its base row, and `/api/collection` does compare-and-set on `baseFingerprint`, answering `409` with the current row.
  - The client does a three-way merge: owned printing and status, wanted-card set merge, delete vs change.
  - Retries use exponential backoff with jitter (max 5 min). A hard 4xx rolls the edit back with a notice.
  - Queued edits are re-applied over any freshly loaded collection.
- **`lib/offline-store/`** (IndexedDB `binderdex-offline`):
  - a durable mirror of the collection, wantlist and pending ops
  - last-known prices
  - opened set lookups (max 40)
  - a one-time migration from localStorage

  Pending ops restore from IndexedDB only if the localStorage queue key is absent.
- **`lib/offline-cache-warmup.ts`**: builds the warm-up URL list, with the visible page's rendered images first.

## Rules

- The binder must open offline and on dead Wi-Fi. Never lose or resurrect queued edits.
- Never cache per-user HTML or auth responses in the service worker.
- Images go through `/api/card-image-proxy`, so they are same-origin and cacheable by the worker.
- When you change cached shapes, bump the relevant cache or key version and handle the old one: migrate it, or drop it in `activate` via `KEEP_CACHES`. Don't rename `binderdex-v3-images` casually; it holds users' cached cards.
- Anything lazy-loaded (`next/dynamic`) must still work offline: the shell precaches the lazy chunks it names.

## Steps

1. Keep the logic pure and in `lib/` where possible, and unit-test it (`tests/offline-*.test.ts`, `tests/collection-offline-queue.test.ts`, `tests/collection-sync.test.ts`).
2. For worker changes, test in a production build (`bun run build && bunx next start -p <your port>`). Service workers don't behave like this in `next dev`.
3. Add or extend e2e with the real worker. Follow `e2e/offline.e2e.ts`, `e2e/offline-store.e2e.ts` and `e2e/offline-writes.e2e.ts`:
   - `serviceWorkers: "allow"`, with context-level mocks
   - wait for the worker to control the page and the shell to be cached, then go offline
   - cover reload, a stalled server and a slow first visit
4. Run only the affected offline specs across all 6 projects. Repeat a focused test only when a failure or suspected flakiness justifies it. Run the full e2e suite only when Cal explicitly asks.
