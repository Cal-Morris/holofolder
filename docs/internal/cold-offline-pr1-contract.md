# #363 PR1: local queue contract, PR2 handoff

Internal implementation notes. This PR enables no controls, does not wire a cached sender, and adds no endpoint, developer API operation, SQL or schema. Base: `3a445741a21cc4d77d20caccd8adab93b5ae2536`. PR2 and the parent own UI integration, review and shipping.

## Local acceptance

`readCachedNativeStartup(store, identity, epoch)` now returns `planning` alongside the existing cached `read` and pending count. `planning` comes from `queue.readLocalPlanning(authSessionId)`, which reads the canonical `slot-intent:v1` record and matching `slot-navigation-v1` metadata in one existing IDB transaction. It includes exact queue `scope`, stable originating `authSessionId`, latest optimistic `snapshot`, pending count, projected layouts, merged normalized catalog and an in-memory `resolver`. It is never a complete remote read. Do not serialize the resolver.

Mount `useSlotOfflineQueue(planning.scope, newPageEpoch, planning.authSessionId)` in the scoped cached child. Never give that child's cached scope to a remote sender. Re-read `await queue.readLocalPlanning()` to prepare each new draft with existing `prepareLayoutIntent` / `prepareSlotPickerIntent`. The hook method `enqueueLocal(draft, isCurrent)` resolves to the existing `SlotLocalAcceptance` only after IDB commit. A later refresh/notification error remains accepted with `refreshError`, so refresh instead of minting duplicate operation or entity IDs.

`draft.localCatalog?: readonly InventoryCatalogEvidence[]` carries the normalized selected printing facts. PR2 must retain this property when stripping preview data from picker output. Build it from the selected cached/search card, including its supplied `pokemonIds`, language and canonical/alias associations; use the same facts to build the preview resolver. No functions, private copy data, guessed species links, price requirement or server catalog authority. Missing catalog association fails before acceptance. Contradictory associations fail closed. Evidence needed by preceding pending commands is retained with later local intents so reprojection survives earlier ACKs and reloads.

Admission re-reads the canonical record and exact baseline metadata inside `updateMany`; it does not trust a supplied planning snapshot. It projects against the latest optimistic graph with original preconditions. A stale draft loses the transaction race and must be prepared again for user review. An exact accepted operation can be retried idempotently with the same intent, evidence and session. No automatic version rewrite or copy substitution.

Only single basic app commands are admitted: one layout append/insert, one slot move, one picker target update/removal, one clear-to-Unassigned, or one assign with occupied=`cancel`. Creation, raw restore, recovery, removal/deletion, purchases, wanted-list edits, bulk/advanced flows remain on their existing contracts. Legacy pending archives, recovery, blocked/billing/conflict state and creation/restore prevent local admission.

`isCurrent` must synchronously check the active cached lifetime, exact cached identity, expiry and access policy again at acceptance. Call hook `invalidate()` immediately on reconnect/account/owner/session/access invalidation, before awaiting live scope or rendering changes; close dialogs in PR2. The callback runs inside the IDB transform. Invalidation before the transform refuses admission; already committed work remains accepted. Hook session lifetime also changes when stable authSessionId changes.

## Baseline and ACK metadata

Replace the browser host's separate baseline save and metadata `store.set` with:

```ts
await queue.saveSnapshotWithNavigation(
  fresh.evidence.snapshot,
  { catalog: fresh.catalog, layouts: fresh.layouts },
  isCurrent,
);
```

Hook method signature: `(snapshot: unknown, navigation: unknown, isCurrent?: () => boolean) => Promise<boolean>`. Queue-level variant takes an active-scope getter. A branded fresh remote snapshot is mandatory. While any intent/recovery is unresolved, it returns `false` and preserves both retained baseline and metadata. Never independently overwrite navigation metadata in that branch. Cached/developer DTOs cannot seed this path. Legacy `saveSnapshot` stays compatible; it refuses changing the baseline under new local intents.

Use the existing hook `replay(send, catalog, readCurrent, isCurrent)` only from the checked live host. For PR2, its separately started fresh read callback must return this internal pair:

```ts
return { snapshot: fresh.evidence.snapshot, navigation: { catalog: fresh.catalog, layouts: fresh.layouts } };
```

Do not write metadata inside that callback. The queue validates freshness, scope, revision, operation ID, lease and original auth session before committing ACK and matching metadata in one `updateMany` transaction. Missing/mismatched metadata cannot ACK a new local intent; the operation remains durable, including its lease if the transaction aborts. Normal lease expiry/exact retry resolves it. New local intents retain `originAuthSessionId`; the checked live hook must supply that exact stable Supabase session ID. New page epochs in the same auth session work. Another account/owner uses another key; another auth session cannot lease/send/ACK these intents. No historical recipient is inferred. Old online intents keep existing behavior and acquire no guessed session retroactively.

Existing sender wire bodies, operation/entity IDs, expected versions, leases, unknown outcomes, rejection proof, backoff, conflict reconciliation and all-stream ACK freshness remain in place. Local card evidence is queue-only and is never sent as authenticated catalog authority. Explicit reconciliation replacements preserve origin session/evidence.

## Proof and remaining gates

Run with Bun **1.3.14**. Focused unit tests cover local sequential planning, cached branding, DTO refusal, evidence persistence/conflicts, stale/lifetime/session fences, missing metadata and atomic failure. `node scripts/verify-slot-offline-storage.mjs` bundles the existing browser fixture and runs real Chromium IDB transactions at 375/390/430 in browser and emulated standalone mode. It exercises competing local queue drafts from two tabs, chained serialization/reload, invalidation inside the transform, wrong-session no-send and a second-put DataCloneError abort after the baseline put was queued. It then retries the original command and checks paired ACK plus dependent reprojection.

This isolated synthetic storage probe is not UI, service-worker, hosted, installed-device or process-kill proof. PR2 still owns cached child/UI wiring, picker evidence handoff, active live host changes, dismissal/lifecycle behavior, offline search/assets and the focused six-project cold relaunch/reconnect end-to-end tests. Parent owns required review/checks, merge and production verification. No full E2E was run in PR1.

## Unpublished help draft

Basic edits will be saved on this device while offline once the cold editing UI is integrated. Saved on device does not mean synced. Reopening offline and a successful reconnect preserve queued edits; syncing requires the same checked account, owner and sign-in session. Missing saved layout/card evidence may prevent an edit. Remote changes may require conflict review.

An online startup failure currently resets this app's entire IndexedDB cache, including pending edits, and reloads once (#517). Retention through that destructive reset is **not** promised. Known-offline startup keeps its existing behavior. This PR preserves the reset policy and does not change its deadline or worker unregistration. Do not publish this draft as a shipped capability before PR2 and parent verification.

## Parent integration correction

Paired replay reads also unwrap correctly for raw restore and creation/command rejection follow-ups. A successful restore ACK commits its matching metadata in the same transaction. Rejection reads retain current conflict evidence without replacing the saved baseline. After explicit keep-remote/discard reconciliation, the checked host must save a fresh snapshot/navigation pair before offering local planning again; replacement commands remain gated until paired ACK.

The lease claim continues through the existing atomic single-record update, preserving existing transaction-abort proof coverage.
