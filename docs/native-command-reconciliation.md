# Staged native command rejection and reconciliation

Related: #363, #383. Preparation only. Public app, REST and MCP admission stays hard 503. No conversion, runtime admission or publication is included. Migration 089 is unapplied to hosted Supabase; the parent owns a fresh restore-verified backup, application, independent review, serialized merge and deployment.

## Why existing SQL is insufficient

074/075 serialize owner writes on advisory lock 4701 and store accepted outcomes in `developer_idempotency` with infinite expiry. Their SQL 40001/23505 errors roll back the command but leave no terminal outcome. A business predicate may later become true, and another exact delivery may still be running. Neither HTTP status, a timeout, a stale revision nor one absent ledger read establishes noncommit. Mapping SQL error messages directly to a client cancellation flag would be unsafe.

## Terminal contract

089 adds one private helper behind the existing service gateway. The gateway still establishes the current authenticated actor, source, owner, paid developer access and locked partnership before dispatch. The helper upgrades the partnership lock to `FOR SHARE` and re-resolves current owner/permission before either owner lock. This blocks non-key owner changes and rejects an owner change committed while it waits. It then takes management lock 6102 then owner lock 4701 **outside** an exception subtransaction. Under that retained lock it checks the existing actor/operation/ID ledger and the exact existing SQL digest, including owner, original request and trusted source/client context. Accepted or rejected replay precedes mutable collection checks. A different actor/source/owner/body never borrows another receipt.

Only whitelisted 40001 command predicates produce terminal rejection. The executor's partial writes and audit deltas roll back first; the helper then commits `{ outcome: "rejected", operationId, code, inventoryRevision }` to the **same lifetime ledger**, under the same digest and operation namespace. Original 074–088 definitions are untouched. No second receipt/history table, cleanup expiry, extra grant or runtime budget is introduced. Statement timeout stays 10 seconds. Arbitrary 40001, 23505, invalid input, access/billing errors, recorder failures and cancellation remain ordinary errors without rejection proof.

Whitelisted reasons: `slot_revision_conflict`, `inventory_revision_conflict`, `inventory_collection_conflict`, `slot_conflict`, `item_conflict`, `placement_conflict`, `inventory_want_conflict`, `inventory_copy_choice_required`, `inventory_destination_empty`, `inventory_destination_occupied`.

The internal first-party HTTP adapter returns private/no-store JSON:

```json
{"version":1,"operationId":"synthetic-command","rejection":{"outcome":"rejected","operationId":"synthetic-command","code":"slot_revision_conflict","inventoryRevision":12}}
```

This envelope has status 409. The browser validates both IDs, bounded known code, revision, exact shape, content type, private/no-store headers and live authenticated session scope. Ordinary errors still use the existing error envelope; its code or status never creates proof. The shared internal REST/MCP execution boundary preserves the same terminal result as data, with current actor/source authority and existing write permissions. Supported public REST/MCP operations and OpenAPI remain staged, so no registry or generated schema changes are made by this slice.

## Durable client states

| State | Supported action |
| --- | --- |
| Matching accepted receipt | Start a separate private complete read after the reply; ACK only with current scope, retained lease and sufficient revision |
| Terminal rejection, current read missing | Persist original command and terminal proof before reading; retry **Refresh current storage** after reload/reconnect |
| Terminal rejection plus fresh complete current state | Explicitly **Use current storage** to cancel the saved edit, or **Rebase saved edit** for nonoverlapping content/metadata changes |
| Structural, overlapping, copy-selection or move conflict | Original retained; queue API accepts a separately reviewed full replacement, browser does not invent one |
| More than one dependent pending command | Retain all commands; single-command cancellation/rebase is refused |
| Unclassified 409, SQL errors, timeout or lost reply | No cancellation or new ID; explicit retry sends the original immutable command |
| Changed account, owner, JWT session or membership epoch | Ignore late work; retain the original account/owner/device queue for its own session |

The fresh-read callback starts after durable proof and collects every private inventory, placement, collection and binder-slot stream. Cached brands, reads already in flight, plain JSON, partial reads, older revisions and changed scopes cannot install a reconciliation base. Failed reads preserve proof for later use. Each browser review decision refreshes again before applying, and the atomic queue update checks the original proof/intent and rejects concurrent leases. Legacy persisted `rejected: true` flags without the new bound proof are downgraded to unknown. Original intent/provenance remains in the existing local queue record after explicit cancellation/supersession.

## UI review

| Before | After | Why |
| --- | --- | --- |
| Every 409 paused with no safe way to load current state | Proven terminal rejection offers current-state refresh | Only a committed terminal outcome enables review |
| Reconciliation required hand-built queue input | Explicit current-state cancellation and constrained rebase | No silently regenerated IDs or selected copies |
| Unclassified conflict could not retry | Retry preserves the exact original command | Unknown outcomes remain resolvable without guessing noncommit |

No new motion, overlay, gesture or storage store is added. Review controls have minimum 36px height and wrapping text; affected phone checks cover three widths and emulated standalone insets. These are Chromium fixture checks, not physical-phone or installed-PWA proof.

## Evidence and remaining acceptance

The original pre-088 archive is retained, SHA-256 `123383c5bba50e057de540d619f066456b223a0b859b3878ddd8ef0b2803f473`. All archive bytes and baseline count/digest manifests remain private and unchanged. Local testing uses a new socket-only PostgreSQL 18 cluster, with ACLs retained and local ownership, plus a separate empty-schema database for committed synthetic races. No other cluster is started or modified. Private count/original-column digest evidence stays outside Git.

Local verification:

- 99 focused unit/contract cases pass with CI Bun 1.3.14, including queue/rebase/reload/scoping, sender validation, actual HTTP bridge, staged developer admission and docs contracts.
- 66 browser-command cases pass across all six Chromium phone profiles, including lost replies, stale ACK reads, account/owner teardown, offline writes, unknown exact retry and terminal rejection → failed read → reload → fresh review → explicit cancellation. No full e2e was run.
- Actual PostgreSQL rollback and separate two-session synthetic race tests pass: exact accepted/rejected delivery, partial mutation rollback, immutable terminal replay even when predicates become valid, removed-collection replay, membership/source/billing denial, both orders of non-key partnership-owner races, cancellation during lock wait, and rollback of uncommitted terminal results. The archive rollback test also passes on exact compiled 088 definitions, verified against the parent's reviewed definition hashes, followed by twice-applied 089.
- All 90 archived table counts and 35 original-column digests match after fixtures; archive hash is unchanged. Existing helper bodies, owners/ACLs and table ACL/RLS remain unchanged; the added helper stays denied to all runtime roles. The service gateway's deadline remains 10 seconds.
- Final production build, full typecheck and full lint pass; lint retains the existing 55 warnings with no additions. The new review flow is rechecked on the final build across all six profiles.

 Parent review, hosted 089 application, authenticated hosted transport/commit-cancellation races, native recovery/Undo, old clients/queues/service worker, representative conversion and all #379 rollout gates remain separate acceptance. Issues stay open. Release text is unpublished.
