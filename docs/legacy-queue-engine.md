# Inactive legacy queue engine

Task 1 of the #363/#379 legacy durability plan adds an **inactive internal engine**, based on `origin/main` c125479e01186e95b924226ffd02aabb3ab4903c. Nothing in production calls its initializer or reads/sends from it. The running legacy queue remains localStorage plus its existing delayed mirror. This slice does not fix that runtime durability boundary or complete either issue.

## Authority and API

`createLegacyQueue(store, active)` takes an explicitly supplied `AtomicOfflineStore` and a synchronous current `{ session, origin }` provider. Production integration must supply real IndexedDB, never the test memory store or a localStorage fallback. The existing v1 `binderdex-offline/records` store contains one `legacy-collection-queue:v2` envelope. There is no new database, store, native queue record or SQL migration.

- `initialize(storage)` captures the exact localStorage queue string before awaiting, then atomically reads the envelope and old `collection` record with `updateMany`. It retains both without modifying either old input. Absent, invalid, empty-array and missing-queue evidence do not imply delivery. Reinitialization preserves the epoch and acceptance history, adding changed observations only.
- `read(scope)` returns copies of the token, exact-origin entries and privacy-eligible retained sources. The active identity is checked before and after the asynchronous read. Sources that include another actor's account data, or mirror values that cannot be safely checked as JSON, remain retained but are excluded from this facade's export view. No scoped read authorizes mutation.
- `enqueue(input, { epoch, entryRevision })` compares the caller's last unresolved exact-origin/Pokémon tail inside the transaction. Disjoint appends survive; stale same-slot input rejects with `queue_changed`. Only an unclaimed ready tail without recovery/source linkage may coalesce. It preserves first ID, base presence, timestamp, origin, original and acquisition lineage, recording amendments. Unbound drafts are retained as paused source evidence. Bound drafts require the captured session/origin to remain active.
- `prepareReview(scope)` returns an epoch/revision/session/origin fence. `acceptReview(token, exactVisibleSources, selections)` checks it and the complete retained visible sources inside the transaction. Each selection identifies a source ID and ordinal plus the reviewed destination input. Acceptance ordinals and linked new intents commit together. The existing `legacyReviewEntries` eligibility rules apply. Mirror-only, duplicate/divergent and account-bound source work cannot be accepted. Nested source wrappers retain all original metadata; this engine conservatively requires separate reconciliation before accepting any source while nested wrappers exist. It never flattens or resets nested acceptance.
- `pauseBatch(reviewEpoch, origin, reason)` pauses only ready actions in that exact reviewed batch. It cannot rewrite a frozen request or clear a compatibility pause.
- `claim(scope, session, holder, now)` serializes across connections. It freezes the POST/DELETE request from retained intent and marks a 60,000 ms lease in the same commit. Only the oldest unresolved action per exact origin/Pokémon can claim; compatibility pauses block the binder. Unrelated slots can progress. Guest actions cannot claim. The serializer uses the existing first-party recipient, base-fingerprint, acquisition and operation-ID contracts. It adds no new protocol header and makes no network call.
- `settle(claim, outcome)` checks epoch, entry ID/revision, session/origin, lease token and exact frozen request. Stale results return `false`. A validated acknowledgment stores the local settlement and full request/intent together before resolving. Known rejection retains its frozen request and pauses; unknown retains it unchanged. Failure pauses remaining ready siblings of a reviewed batch. There is deliberately no conflict-rebase, cancellation or retry API in this slice.
- `observeOldSource(observation)` adds exact old strings or structured mirror observations as evidence only. Reobserving the exact source does not reopen accepted ordinals. Old `[]` or a delayed `collection` overwrite cannot delete current intents.

All transforms are synchronous and have no transport, clocks, ID generation, event dispatch or external storage writes inside them. IDs, timestamps, inputs and active context are captured before the first await. Mutation results are copies returned only after the transaction completes. Failures throw without localStorage/memory fallback, source eviction or replacement of malformed/future envelopes. Duplicate request IDs remain separate evidence entries identified by source and ordinal.

LocalStorage retains the exact JavaScript string, including whitespace; no encoding, disk-byte or fsync guarantee is claimed. Mirrors retain structured values and do not recover original serialization bytes. Full string/value comparisons authorize reuse, never digest equality. Non-plain structured mirror values are conservatively retained separately when equality cannot be established. Completed entries and Activity event IDs are **local evidence**, not durable server receipts or exactly-once delivery proof.

## Proof and limits

Run:

```sh
bun test tests/legacy-queue-atomic.test.ts tests/binder-slots-offline.test.ts tests/offline-store.test.ts
node scripts/verify-legacy-queue-storage.mjs
node scripts/verify-slot-offline-storage.mjs
bun run typecheck
bun run lint
```

The focused units exercise transitions, scope/session/revision/request fencing, source acceptance, absent-base preservation, source duplicates, structured mirror retention, corruption and storage failure. The isolated Chromium runner uses two pages with independent actual IDB connections and reloads the retained state. Its fault injector delegates to real Chromium transactions and aborts in a real `put` success listener, before transaction completion. Initialization, enqueue, acceptance and settlement reject without changing the preceding committed envelope. It also tests competing claims, independent appends, stale review/session/token results, transform/clone/write-scope failures and old-source overwrites. The existing native storage runner and native unit tests protect the shared additive primitive boundary; native semantics are unchanged.

These are synthetic desktop Chromium transaction proofs. No real worker, app sender, production endpoint, installed PWA, physical-device eviction, power loss, network delivery or hosted receipt contract is verified. The native runner's standalone modes are emulations. No full e2e suite is run.

## Coordinated migration blockers

Do not initialize this engine in production until **all legacy writers migrate together**. Subsequent work must hydrate independently of snapshot fallback, retire updated localStorage queue/mirror writes and restore paths, adapt every enqueue/review/settlement caller, and replace immediate/background sends with one claimed sender. It must enforce durable-before-UI/snapshot/notification/send ordering and current session checks after claim commit. The future sender must classify validated responses and preserve PATCH reviewed-base CAS wherever PATCH is used; this engine does not activate or alter that route.

Later integration must observe old LS/mirror ingress at startup/resume and events, including `StorageEvent.oldValue`, without reopening acceptance or treating old arrays as ACKs. Unobserved overwritten old bytes cannot be recovered. Nested sources and divergent copies need explicit reconciliation, not automatic replay. Migrated account/mirror requests remain delivery-unverified. Lease expiry changes sending to unknown on a later claim inspection and never grants replay; a suspended sender may still finish, and an expired claim cannot settle after that transition.

The reject-only first-party protocol fence, immutable old deployments/origins/direct ingress and requests already past validation require parent-verified containment and in-flight draining before release. A header alone does not solve them. Unknown-outcome automatic recovery needs a separately verified server receipt contract. Storage-pressure measurement, evidence archival, installed-device crash/eviction and rollout validation remain separate gates.

This is a device-only internal persistence API. It introduces no public REST/MCP endpoint, schema, help action or advertised capability. Public API generation, user help and marketing content remain unchanged. The parent owns issue/project progress, independent review, merge/deployment, hosted operations and the later runtime cutover. Inventory/graded UI, native admission, SQL and server protocol are outside this slice.
