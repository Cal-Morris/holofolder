# Staged safe collection recovery (#396)

Migration **077** adds SQL-owner-only preview/apply to the deployed 076 recorder. It is a **partial internal implementation**, not enabled recovery. Activity remains read-only, including the accepted #395 release published at Framer version `ca377c12f`. There is no recovery HTTP route, shared REST/MCP registry entry, app wrapper, permission grant, environment toggle or Undo integration in this PR. The existing slot/inventory app routes remain unconditional private/no-store 503; all fourteen 074/075 functions and every private audit/recovery function remain denied to anon, authenticated, holo_mcp and service_role. No real binder is converted.

## Implemented scope

The inverse comes from the immutable event's private `recovery_state`, never a submitted owner snapshot. Supported evidence is format 1, within 16,384 touched entities / 16 MiB, and contains only:

- Owned-copy add/edit/removal, including exact recorded grade, certificate and acquisition date, with stable owned item IDs. Duplicate printings remain separate copies.
- Placement assignment/move/swap/unassignment, slot content/status/wants/target edits, and structural slot insertion/removal/order changes with recorded layout revisions. All inverse effects commit together.
- Deletion of a **native slot-backed collection** with complete supported deltas, including default replacement where that recorded replacement is still unchanged. The original collection/slot/item IDs and saved relative order are retained. Existing name/ID/default constraints, binder allowances, custom-grid entitlement triggers and the 4,096-slot capacity remain effective.

Current rows must equal the original final state, including independent item/slot/placement versions and absence. Later changes to the same copy/slot/placement, including grade changes and ABA edits, conflict even if some visible fields match again. Structural recovery requires the recorded final layout revision and retained position/anchor evidence. Layout positions are restored only after those checks; no occupied position is silently displaced.

Unrelated later partner rows survive. Global owner and collection counters are advanced from their **current** values, never set to historical values. A content-only inverse does not rewind layout. Dependencies include current collection metadata, layout, related items and placements; changes between preview and apply invalidate the reviewed fingerprint, requiring a fresh preview and confirmation. Renaming a collection does not get overwritten as a side effect of recovering an item. A later rename/default change to a binder actually being restored is a named conflict.

`restoreUnassignedItemIds` is an explicit alternative only for a deleted owned copy and its recorded isolated placement/status clearing. It skips that old placement and its status-only slot inverse, retaining current slot content/occupancy. If the former collection was subsequently deleted, its unused pure content-counter inverse is omitted too; the collection is not resurrected. It cannot skip a layout/target/wants change, substitute a different copy, or create a new identity. Other conflicts still reject the whole batch. The same exact item ID and original metadata are restored, with a new version. Current allowance enforcement still applies.

## Deliberately unsupported evidence

These return `supported: false` and explicit reason strings, with no usable plan token:

- Format 0, missing/empty inverse evidence, or evidence exceeding the recorder bounds.
- Legacy `pokemon_collection`, `binder_legacy_rows`, conversion/authority transitions and converted collections with a conversion receipt. Mixed legacy default replacement and lossless frozen-row recovery are not enabled here.
- Appearance/user configuration, share rows, auxiliary search/history/push state, and any other unrecognized table. A collection deletion that captured any such row is rejected as a **whole event**, never partially recovered.
- Label asset IDs requiring a current private asset authorization/availability registry. That registry is not shipped, so restoring such a grade fails explicitly rather than dropping assets or guessing permission. Certificate text without label assets remains private and is preserved exactly.
- Undo of collection creation, storage-kind/configuration transitions, and cross-owner transfer. Owned-copy and slot additions can be reversed safely; collection creation has additional compatibility effects outside this slice.
- Structural changes without retained layout-root evidence. Direct writes with insufficient inverse/dependency evidence cannot acquire guessed layout intent.

Never restore share tokens, automatically reenable sharing, or replay acquisition/push queues. This executor touches none of those tables. A revoked share remains revoked when an unrelated ownership event is recovered. Appearance/config recovery must later validate assets and current entitlements, regenerate applicable search projections from restored source state, and preserve sharing/notification privacy. No old search projection or delivery queue may be replayed as historical state.

The **#383 admission gap remains separate**: 074/075 still admit only 256 work units and cap their result at 1 MiB, so they cannot currently submit full-Dex/maximum collection deletion. Recovery consumes an actual 076 touched-state event up to its larger bounds directly in one transaction. Local tests model a 1,025-slot removal and default-collection cascade with genuine capture and verify atomic recovery. They do not claim that 074/075 can admit those forward commands. Do not replace that required atomic forward operation with manual slot deletion. Large-event service deadlines and populated-history growth benchmarks remain pre-exposure gates; the bound is not a latency guarantee.

## Private SQL contract

All examples refer to an isolated synthetic database. These functions are **not** PostgREST RPCs available to an admin service-key client; schema and EXECUTE access remain revoked.

`collection_audit_private.recovery_preview_v1(actor uuid, owner_id uuid, event_id bigint, unassigned text[] DEFAULT '{}')` is STABLE and read-only. It checks current membership and billing policy and returns:

```json
{
  "planVersion": 1,
  "eventId": "123",
  "supported": true,
  "unsupported": [],
  "conflicts": [],
  "planToken": "<opaque SHA-256 fingerprint>",
  "restoreUnassignedItemIds": [],
  "changes": [{"table":"inventory_items","id":"synthetic/copy-a","before":null,"after":{"id":"synthetic/copy-a"}}],
  "rootRevisionsAdvance": true
}
```

The synthetic shortened `changes` example illustrates direction only: `before` is current recorded final content, `after` is intended restored content. Root/entity revision fields are omitted from this descriptive projection; the apply receipt provides actual final root revisions. It is not a writable snapshot. The token binds plan version, original event, actual actor, resolved owner, selected Unassigned alternatives, original private inverse and complete current dependency values/absence. Private certificates/labels/asset references, artwork references and share secrets pass through 076's redactor before returning. Conflicts identify entity keys and stable reasons, never private row contents. Unsupported/conflicted plans have a null token. Preview emits no audit event and no idempotency record.

`collection_audit_private.recovery_apply_v1(actor uuid, owner_id uuid, request jsonb, trusted_intent jsonb)` accepts exactly:

```json
{
  "eventId": "123",
  "planVersion": 1,
  "planToken": "<reviewed fingerprint>",
  "operationId": "synthetic-recovery-0001",
  "restoreUnassignedItemIds": [],
  "confirmed": true
}
```

The fourth parameter is the existing trusted `{source, clientId, batchId, clientOccurredAt}` envelope. Only user sources app/rest/mcp/import are accepted; a caller cannot supply a system/migration recovery actor. **SQL parameters are not authentication.** Runtime access remains denied until a reviewed shared server adapter binds actor/owner/source/credential ID from actual session/API/OAuth transport and permissions, independently of the client's JSON. Existing #394 server attribution boundaries must be reused. There is no new GUC/header trust or runtime grant here.

Apply rechecks live membership before ledger replay, holds the current membership row even for owner-initiated restoration of partner wants, takes the existing owner/billing advisory lock (4701), locks current touched dependencies, and validates a freshly computed fingerprint. Explicit confirmation and matching plan version are mandatory. Inserts require absent stable IDs; they are never upserts. Occupied destinations, removed dependencies or changed versions reject all work. Existing current rows are updated individually; unrelated rows are not replaced. Entity versions increase; root versions increase once per accepted recovery. Current allowance/entitlement checks run in the same transaction. No partial success or force flag exists.

The existing `developer_idempotency` ledger stores `recovery_v1` by actor/original operation ID, owner, exact request and trusted intent, with account-lifetime expiry. A replay after current authorization returns the committed result before stale checks. Changing input under the same ID conflicts. Same-ID concurrent callers serialize and return the same result, creating one inverse and one new event. After an unknown outcome, retry the same ID/recipient/intent. Never automatically manufacture a new copy intent.

The existing deferred recorder is forced before returning. It appends a **new** `collection_activity` event with `action: recovery.apply`, trusted actual actor/source, new operation ID, final touched/root versions and `recovery_of_event_id` pointing to the immutable original. The additive column has no cascading event FK; original event/account privacy retention remains unchanged. Recorder failure rolls back state, ledger and history. Original events are not updated, and the immutable guard is unchanged. Recovery must run in its own transaction, not be combined with pending unaudited work for that owner.

The receipt is `{recoveredEventId, eventId, inventoryRevision, collections:[{collectionId,version,layoutRevision}]}` with string event IDs and final root counters. It contains no item certificates, label data or asset URLs. Existing first-party/public reader column lists intentionally do not expose the new link yet; no SELECT or EXECUTE grant is added by 077.

Internal SQL errors: `22023 invalid_recovery_request` / `invalid_unassigned_recovery`, `42501 recovery_access_denied` / `recovery_event_unavailable`, `0A000 recovery_unsupported`, `40001 recovery_plan_conflict` / `idempotency_conflict` / `recovery_dependency_conflict`, `25001 recovery_requires_separate_transaction`, existing billing/entitlement/capacity errors, and recorder failure. A future adapter must sanitize native constraint details and map authentication/authorization, stale conflicts (409), unsupported scope, allowance/entitlement (402), and missing/staged schema (503). These are **not currently implemented HTTP responses** for recovery. Preview does not reserve allowance or promise that later billing/catalog/constraint checks will succeed.

## API, Activity, Undo and offline integration still required

#396 stays open. Its **Activity integration carried from #395** is preserved:

- Extend the safe audit domain model/reader and detail UI to identify and open original/new linked events without mutating history. Supply authorized lookups in both directions through the existing audit boundary.
- Deliver supported preview/apply in the shared REST/MCP registry and app wrapper together with real auth, permissions, paid developer policy, current membership/entitlement checks, sanitized errors, explicit confirmation and version/idempotency schemas. #376 owns shared conventions. Keep internal raw plans private. Generate OpenAPI/help/Markdown/agent docs from that actual registry; no fictional supported operation is registered now.
- Only then expose supported recovery/conflict affordances in Activity and route short Undo through the same command semantics. Add the focused mobile find → inspect → recover/resolve → verify content/location/new linked event flow at 375/390/430 in browser and standalone modes. No UI/overlay changes or full e2e run belong to this schema worker.
- Integrate #363's durable offline flow: a preview/draft or pending operation is not shared restoration. Preserve account/owner recipient, original operation ID and original trusted intent across unknown outcomes; do not enqueue a fresh acquisition/copy intent automatically. Re-read a complete authoritative snapshot after accepted/replayed recovery before acknowledging it locally. Never upload/replay legacy acquisition delivery queues.
- Complete legacy/conversion/auxiliary/private-asset recovery, oversized-evidence and large-event latency/growth proof, then #379's compatibility and production owner/partner/stale-recovery proof before enabling core edits. [078](atomic-inventory-operations.md#atomic-whole-collection-deletion-078-internal-only) adds exclusive 1,025/4,096-slot forward admission and genuine 077 inverse tests without changing this executor or its partnership-before-owner lock order. Preserve the accepted read-only release wording until enabled production proof exists. Parent owns independent review, acceptance, migration backup/application, merge/deploy and publisher coordination.

## Apply and verification

Apply **only 077**, as one DDL transaction after applied/verified 076, with a fresh parent-owned restore-verified hosted backup. No concurrent index statement is needed: 077 adds nullable metadata columns and private functions, and makes no data rewrite. Never edit/reapply 073–076 to change behavior. Before and after, compare original column projections, counts, billing/ACLs, the valid operation uniqueness index, empty transient/new storage tables and denied function privileges. The existing app works before and after 077 because it calls no recovery functions and reads explicit safe columns. Deployment and migration can occur in either order while gated. Disable exposure rather than deleting history/ledger/evidence as rollback; no exposed capability is enabled by this file.

Local proof uses the preserved pre-076 archive SHA-256 `24e5ef19412e29638c00543c7455e31ac5bf790247aebd67414a1cd2965b058d`, restored to a new PostgreSQL 18 instance on a private Unix socket, port 55496. Current-main 076 was applied twice (its unique concurrent index separately), followed by 077 twice. Auth/account data and dumps stay private. Tests use labelled synthetic fixtures, roll them back, and clean the committed concurrency account through the account privacy cascade. Other workers' processes/backups are untouched.

```sh
COLLECTION_RECOVERY_TEST_SOCKET=/Users/cal/.local/share/holofolder/issue396-local/socket \
  bun test tests/collection-recovery-sql.test.ts
bun run test
bun run typecheck
bun run lint
bun run build
```

The isolated SQL proof covers read-only preview, current actor binding, independent newer partner rows, same-copy stale move/grade, duplicate printings/stable copy IDs, occupied or subsequently deleted former placement/collection with explicit Unassigned, exact private grading/acquisition retention and redaction, missing asset refusal, current allowance bulk rollback, recorder rollback, immutable original/new link, revoked membership even on replay, denied runtime spoofing, legacy/format-0 unsupported events, 1,025-slot/order/default-collection recovery, renamed default-replacement conflict, revoked sharing staying revoked, and two simultaneous committed idempotent callers. It is local correctness proof, not production, maximum-bound load, real browser, REST/MCP auth, OAuth, service-worker or mobile proof.

Final local preservation proof: all 88 original counts and 35 original-column digests match the pre-076 source snapshot; fourteen staged command functions and all private audit/recovery functions have zero runtime EXECUTE grants, transient tables are empty, and the operation uniqueness index remains valid. A rolled-back synthetic 1,025-slot preview EXPLAIN measured about 416 ms in this small isolated history; it is not a production or growth benchmark. Full unit/typecheck/lint/build checks pass, with 55 existing lint warnings and none added. Private receipts/logs remain under `/Users/cal/.local/share/holofolder/issue396-local/`; no dump/auth data is attached to the PR.

The existing 076 audit SQL regression also passed with 077 installed, using a private copy adapted only for this worker's socket/import paths and reapplying 077 after its setup. It separately verifies accepted direct-RLS/service/app/API provenance, spoofing resistance, legacy acquisition/outbox exactly once, recorder-failure rollback, retention, immutability and account deletion under the extended recorder. The committed 076 test and migrations073–076 are unchanged.

Parent review regression: owner recovery also locks current partnership before the owner lock, so an unlink cannot commit while a restored partner wanted entry is still uncommitted. A two-session test failed on the original executor because unlink succeeded, then passed with the membership lock; after unlink wins, preview names the revoked wanted member. Owners without a partner retain normal recovery access.
