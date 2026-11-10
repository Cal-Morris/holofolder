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
- **`lib/collection/slot-offline-queue.ts`** (with `hooks/use-slot-offline-queue.ts`): the native storage command queue in IndexedDB. Commands replay exactly when back online (`lib/collection/storage-command-browser.ts`), then a fresh inventory read confirms them.
- Signed-out guests are read-only and queue nothing. The old localStorage collection queue (`pokemon_collection_pending_ops_v1`) and its IndexedDB mirror are gone; old snapshots (`pokemon_collection_snapshot_v1*`) are only still read by the startup paths in `lib/offline-shell.ts` and `lib/binder-start.ts`.
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
- Public card images use `https://assets.holofolder.com/cards/...`; Pokémon artwork and missing-card fallbacks use `/api/card-image-proxy`. The worker caches both, including CORS asset fetches, and reuses pre-upgrade proxy/show images offline. Keep both cache formats working.
- When you change cached shapes, bump the relevant cache or key version and handle the old one: migrate it, or drop it in `activate` via `KEEP_CACHES`. Don't rename `binderdex-v3-images` casually; it holds users' cached cards.
- Anything lazy-loaded (`next/dynamic`) must still work offline: the shell precaches the lazy chunks it names.

## Steps

1. Keep the logic pure and in `lib/` where possible, and unit-test it (`tests/offline-*.test.ts`, `tests/binder-slots-offline.test.ts`).
2. For worker changes, test in a production build (`bun run build && bunx next start -p <your port>`). Service workers don't behave like this in `next dev`.
3. Add or extend e2e with the real worker. Follow `e2e/offline.e2e.ts`, `e2e/offline-store.e2e.ts` and `e2e/offline-writes.e2e.ts`:
   - `serviceWorkers: "allow"`, with context-level mocks
   - wait for the worker to control the page and the shell to be cached, then go offline
   - cover reload, a stalled server and a slow first visit
4. Run only the affected offline specs across all 6 projects with `bun run test:e2e:matrix e2e/<affected>.e2e.ts`. Repeat a focused test only when a failure or suspected flakiness justifies it. Run the full e2e suite only when Cal explicitly asks.

## Staged legacy durability boundary

Production still uses the legacy queue above. Only the existing loopback E2E
harness with `?durableQueue=1` admits the coordinated transactional hook/review
path. That path never writes/restores the LS queue or mirrored pending ops;
old sources remain additive evidence. Both send triggers share one committed
claim sender, and unknown outcomes never retry. See
[`docs/legacy-queue-staged-runtime.md`](../../../docs/legacy-queue-staged-runtime.md)
for proof limits and the parent-owned trusted-context/ingress cutover gate.
