# Legacy device changes and immutable recipients

Related: #363, #379. This slice leaves public native admission, bootstrap and conversion staged at 503. It adds no SQL, native uploader or migration.

## First-party recipient boundary

Every new legacy edit captures its origin synchronously before the first delivery await. Account intent contains the actor, owner and concrete binder. Guest intent contains a stable device workspace and local binder. An unresolved authenticated context stays unbound; later login, membership lookup, default changes or snapshots cannot bind it.

The existing localStorage queue is the authority. `intentProtocol: 1`, the original operation ID, timestamp and `original.raw` preserve the captured intent independently of mutable delivery/base/conflict state. Coalesced unsent amendments retain the first identity and original plus the amendment records. A sent operation cannot be coalesced. Its original acquisition IDs and base absence remain evidence even after delivery rebasing.

`POST` and `PATCH /app/api/collection` require `recipient: {kind:"account",actorUserId,ownerUserId,binderId}` and matching explicit `binderId`. DELETE requires the same actor/owner/binder as query parameters. The handler independently authenticates the actor, resolves current membership and checks that exact binder belongs to the asserted owner. Assertions grant no access. Neither default-binder nor owner-only/missing-schema fallback is allowed for these first-party writes.

Missing bindings, including an older first-party client, return **503** with `code: collection_recipient_required` and `retainOnDevice: true`. Changed actor/owner returns `collection_recipient_changed`; missing/inaccessible binder or binder schema returns `collection_recipient_inaccessible`, also retention-safe 503. The updated client classifies these before row-conflict merging and permanent-error removal. Old clients retain and retry their queue on 503. They must reload to obtain the review flow.

The verified server context and atomic modes used by developer REST/MCP remain separate. No new first-party assertions are fabricated for those callers. The device review endpoint is deliberately app-only: it reads a cookie-authenticated destination for local browser evidence and performs no acceptance or write. Device source bytes are not a public server resource or a second developer replay API. Public operation schemas and OpenAPI therefore do not change.

## Historical evidence and explicit review

Before a queue mutation, its exact raw source string is retained as `legacyQueueSource` records inside the same queue and existing IndexedDB mirror. Source records contain a digest, raw string and accepted entry ordinals. Invalid JSON stays opaque. Ordinals preserve missing/duplicate IDs, unknown protocols and malformed entries in source order. The digest is an index; exact source/queue strings, not a hash alone, fence acceptance. Unknown source records never contribute optimistic overlays, billing deltas or automatic uploads. Bound other-account operations stay retained and hidden.

The banner offers Review changes and Keep on this device. A review freezes guest drafts into source evidence in the existing authority. It labels Guest workspace or Older changes, original account unknown. It independently loads account, owner, sharing and existing binders from `/app/api/collection/review-destination`, with no selected destination. It previews representable additions, replacements and removals, with individual explicit choices. Unknown fields, acquisition semantics, duplicate source IDs/species/wanted printings, wanted-by metadata and absent/unreadable original bases remain visibly unresolved. Nothing is deduplicated by the wanted normalizer.

Reload destination clears choices and replaces the reviewed bases. Scope changes close the review. Final acceptance rechecks actor/owner/sharing and selected destination rows, checks the exact source queue, then performs one synchronous queue-key replacement containing retained evidence, accepted ordinals and NEW linked recovery actions against the reviewed bases. Those new actions use the same uploader. They never relabel or replay the original historical request.

A changed destination or review conflict blocks the new action. A lost/unreadable reply stops recovery replay with its request ID and base retained. Check the original binder and Activity before making another edit; no exactly-once claim is made. Cancel upload pauses remaining actions, but cannot undo an in-flight request. Original source downloads contain the original string, including whitespace or invalid JSON. Download also retains blocked current requests when present.

The #495 compatibility pause, `rawRecord` and binder barrier remain non-clearable by this review. A known converted-binder source is unresolved even when other entries are accepted. The old local-ID merge/replace action now directs users to review instead of bypassing it with direct Supabase writes.

## Proof limits

This is a synchronous single-key acceptance boundary, not a new transactional outbox. The existing IndexedDB mirror is delayed. Crash windows, cross-tab races between read and write, and an old tab overwriting the queue remain durability gates. Storage failure before authority persistence stops delivery and leaves the preceding source untouched; this does not prove crash-proof or cross-tab atomicity. Source downloads remain useful outside the editable projection.

First-party saves and status changes use the existing `save_collection_with_acquisition` kernel; deletes use `developer_delete_collection` with the exact loaded row. There is no direct-write fallback when an atomic save is unavailable. These existing kernels recheck binder/membership within the write. Local adapter tests do not re-prove SQL locking or hosted transaction behavior. No durable first-party operation receipt was added. Native receipt/transaction authority is unchanged. Existing ordinary account network/row-conflict/billing policy remains distinct from reviewed recovery's fail-closed unknown outcomes. Local mocked HTTP/UI/storage checks are not hosted, provider or physical-device proof.


## Local verification

- 80 focused unit/contract tests across 14 files, including real local HTTP handlers with synthetic authenticated identities/database adapters, exact-recipient atomic-kernel arguments, schema failures and membership denial at the write.
- `bun run typecheck`, `bun run lint` (55 existing warnings, no additions), production build and generated API docs. Public OpenAPI output is unchanged.
- 102 affected production UI cases across 375×667, 390×844 and 430×932, in browser and standalone PWA mode with 59/34 px insets. Includes A→B→A stale responses, review invalidation, exact original downloads, cancel during an in-flight batch, and failed acceptance preserving both localStorage and real IndexedDB evidence. The review panel has a stable height while destination data arrives.
- No full e2e suite, hosted/provider/physical-device or service-worker rollout proof. An exploratory full local unit run hit an unavailable private PostgreSQL integration fixture and subsequent Bun `node:test` nesting errors; the focused suites above pass. No integration database was started or modified.
