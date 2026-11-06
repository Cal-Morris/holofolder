# Binder history

Regular Search, Quick mode and Show mode share recent searches (8) and viewed cards (20; Show displays the newest 10). Searches are recorded on a result selection, Enter or a recent-search tap, never per keystroke. Card selections and successful scans record the printing metadata available at that moment. No price-provider checks are triggered by history.

Signed-in history belongs to the active binder. The owner and authorized partner can read and add to it. The authenticated `sync_binder_history` RPC checks the expected account, binder owner and partnership before doing anything. RLS permits the same reads; direct client table writes are prohibited. Read-only share views disable private history entirely.

Each committed action is appended to an independent device queue, scoped by account + owner + binder. The local view updates immediately. On open, focus and reconnect, the client sends pending actions and replaces its server snapshot. A failed request keeps the queue and shows a local-only notice. The collection edit queue is untouched. Until migration 043 is applied, history stays scoped on the device and retries when opened/focused/online.

The server serializes a binder's actions in one transaction, upserts individual entries and stamps them with server time. Per-device sequence receipts make retries idempotent, including after another device has changed an entry. History lists are pruned in that transaction.

## Clear for everyone

Cards and searches have separate Clear actions. Each explicitly says “Clear for everyone” for shared binders. Clear changes that list's generation and deletes its entries. An offline action from before that generation is acknowledged but discarded, so another device cannot restore cleared history. New actions after learning the new generation are accepted. An offline Clear and the actions made after it are queued in order. If a different device clears again before they sync, those older-generation actions are discarded too.

Anonymous history remains on this device. Existing globally unscoped history is never copied into a signed-in binder or uploaded automatically. Signed-in caches and queues are also separated by account, even for two partners sharing a binder. Changing binders/accounts cannot retarget a queued action. A signed-in legacy session without a binder ID uses a scoped local cache until a binder is available; it does not upload that cache implicitly.

## Verification

`bun test tests/binder-history.test.ts tests/recent-cards.test.ts` covers normalization, local queue reconciliation and clear conflicts. `scripts/verify-binder-history.ts` requires an explicit `HISTORY_TEST_DATABASE_URL`: it verifies migration idempotence, owner/partner/stranger/anonymous access, RLS, account/binder isolation, bounds, timestamps and retries. Local databases also exercise concurrent connections. Hosted verification requires `HISTORY_ALLOW_HOSTED_ROLLBACK=1` and always rolls back all fixtures and migration statements.

Focused browser coverage is in `e2e/shared-history.e2e.ts`, `e2e/show-recents.e2e.ts`, `e2e/recent-cards.e2e.ts` and `e2e/compound-search.e2e.ts`.
