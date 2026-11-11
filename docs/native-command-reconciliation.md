# Staged native command rejection and reconciliation

Related: #363, #383. Preparation only. Public app, REST and MCP admission stays hard 503. No conversion, runtime admission or publication is included. Parent applied migration089 to hosted Supabase after independent review and a fresh restore-verified backup; serialized merge, deployment and enabled acceptance remain separate gates.

## Why existing SQL is insufficient

074/075 serialize owner writes on advisory lock 4701 and store accepted outcomes in `developer_idempotency` with infinite expiry. Their SQL 40001/23505 errors roll back the command but leave no terminal outcome. A business predicate may later become true, and another exact delivery may still be running. Neither HTTP status, a timeout, a stale revision nor one absent ledger read establishes noncommit. Mapping SQL error messages directly to a client cancellation flag would be unsafe.

## Terminal contract

089 adds one private helper behind the existing service gateway. The gateway still establishes the current authenticated actor, source, owner, paid developer access and locked partnership before dispatch. The helper upgrades the partnership lock to `FOR SHARE` and re-resolves current owner/permission before either owner lock. This blocks non-key owner changes and rejects an owner change committed while it waits. It then takes management lock 6102 then owner lock 4701 **outside** an exception subtransaction. Under that retained lock it checks the existing actor/operation/ID ledger and the exact existing SQL digest, including owner, original request and trusted source/client context. Accepted or rejected replay precedes mutable collection checks. A different actor/source/owner/body never borrows another receipt.

Only whitelisted 40001 command predicates produce terminal rejection. The executor's partial writes and audit deltas roll back first; the helper then commits `{ outcome: "rejected", operationId, code, inventoryRevision }` to the **same lifetime ledger**, under the same digest and operation namespace. Original 074–088 definitions are untouched. No second receipt/history table, cleanup expiry, extra grant or runtime budget is introduced. Statement timeout stays 10 seconds. Arbitrary 40001, 23505, invalid input, access/billing errors, recorder failures and cancellation remain ordinary errors without rejection proof.

Whitelisted reasons: `slot_revision_conflict`, `inventory_revision_conflict`, `inventory_collection_conflict`, `slot_conflict`, `item_conflict`, `placement_conflict`, `inventory_want_conflict`, `inventory_copy_choice_required`, `inventory_destination_empty`, `inventory_destination_occupied`.

The internal first-party HTTP adapter returns private/no-store JSON:

```json
{
  "version": 1,
  "operationId": "synthetic-command",
  "rejection": {
    "outcome": "rejected",
    "operationId": "synthetic-command",
    "code": "slot_revision_conflict",
    "inventoryRevision": 12
  }
}
```

This envelope has status 409. The browser validates both IDs, bounded known code, revision, exact shape, content type, private/no-store headers and live authenticated session scope. Ordinary errors still use the existing error envelope; its code or status never creates proof. The trusted execution boundary preserves this validated result as data for the first-party envelope above. The shared developer dispatcher converts it to a typed `storage_command_rejected` error only for `execute_slot_commands` and `execute_inventory_commands`, after the existing original-intent parser, recipient fence and authenticated execution. REST returns 409; MCP returns `isError:true`, with identical structured fields and JSON text. Both use the shared developer error formatter:

```json
{
  "error": {
    "code": "storage_command_rejected",
    "message": "The original storage command was rejected. Refresh current storage before explicit reconciliation.",
    "requestId": "synthetic-request",
    "rejection": {
      "outcome": "rejected",
      "operationId": "synthetic-command",
      "code": "slot_revision_conflict",
      "inventoryRevision": 12
    }
  }
}
```

Only the trusted gateway's exact four-field terminal row, bound to the original operation ID, can create this error. Malformed, extra-field, wrong-ID or unknown-code terminal rows fail closed as `storage_unavailable`; they cannot fall through into accepted receipt projection. Ordinary conflicts, stale preconditions without a ledger outcome, arbitrary 40001/23505, timeouts and absent ledger evidence never acquire a rejection. Unknown outcomes retain the same original request/ID, source, credential and recipient for explicit retry. A terminal revision describes the ledger outcome, not current storage; it is never a complete read or permission to cancel automatically.

Registry `errorSchemas[409]` declares the strict terminal envelope alongside the unchanged ordinary error envelope. OpenAPI and its derived reference/Markdown/LLM exports expose both. MCP advertises the accepted receipt as `outputSchema` and status-keyed error schemas in tool `_meta["holofolder.com/errorSchemas"]`. The SDK validates successful structured output and skips output validation on `isError`; the shared formatter validates the terminal envelope itself. Accepted schemas remain unchanged and do not admit error objects. No original intent, private grading/wants/assets/history, actor/member/owner lists or credential context is serialized. Copied creation and arrangement import keep their accepted receipts and existing errors. Native recovery has its own additive 092 terminal error contract below, without reusing command proof.

The real REST handler and MCP HTTP SDK tests use synthetic current authority and RPC/ledger data. They cover accepted/rejected replay, lost accepted/rejected replies, changed ID/body/owner/source/credential/actor, malformed terminal rows, ordinary errors and current authorization/entitlement denial before executor data. A separate fixed-gate run proves zero execution; another SDK test proves malformed success output is rejected while a typed tool error survives. These are local transport proofs, not fresh SQL, hosted command or enabled acceptance. Admission remains unconditional 503. #376 and #379 remain open.

## Durable client states

| State                                                    | Supported action                                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Matching accepted receipt                                | Start a separate private complete read after the reply; ACK only with current scope, retained lease and sufficient revision       |
| Terminal rejection, current read missing                 | Persist original command and terminal proof before reading; retry **Refresh current storage** after reload/reconnect              |
| Terminal rejection plus fresh complete current state     | Explicitly **Use current storage** to cancel the saved edit, or **Rebase saved edit** for nonoverlapping content/metadata changes |
| Structural, overlapping, copy-selection or move conflict | Original retained; queue API accepts a separately reviewed full replacement, browser does not invent one                          |
| More than one dependent pending command                  | Retain all commands; single-command cancellation/rebase is refused                                                                |
| Unclassified 409, SQL errors, timeout or lost reply      | No cancellation or new ID; explicit retry sends the original immutable command                                                    |
| Changed account, owner, JWT session or membership epoch  | Ignore late work; retain the original account/owner/device queue for its own session                                              |

The fresh-read callback starts after durable proof and collects every private inventory, placement, collection and binder-slot stream. Cached brands, reads already in flight, plain JSON, partial reads, older revisions and changed scopes cannot install a reconciliation base. Failed reads preserve proof for later use. Each browser review decision refreshes again before applying, and the atomic queue update checks the original proof/intent and rejects concurrent leases. Legacy persisted `rejected: true` flags without the new bound proof are downgraded to unknown. Original intent/provenance remains in the existing local queue record after explicit cancellation/supersession.

## UI review

| Before                                                  | After                                                      | Why                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Every 409 paused with no safe way to load current state | Proven terminal rejection offers current-state refresh     | Only a committed terminal outcome enables review              |
| Reconciliation required hand-built queue input          | Explicit current-state cancellation and constrained rebase | No silently regenerated IDs or selected copies                |
| Unclassified conflict could not retry                   | Retry preserves the exact original command                 | Unknown outcomes remain resolvable without guessing noncommit |

No new motion, overlay, gesture or storage store is added. Review controls have minimum 36px height and wrapping text; affected phone checks cover three widths and emulated standalone insets. These are Chromium fixture checks, not physical-phone or installed-PWA proof.

## Evidence and remaining acceptance

The original pre-088 archive is retained, SHA-256 `123383c5bba50e057de540d619f066456b223a0b859b3878ddd8ef0b2803f473`. All archive bytes and baseline count/digest manifests remain private and unchanged. Local testing uses a new socket-only PostgreSQL 18 cluster, with ACLs retained and local ownership, plus a separate empty-schema database for committed synthetic races. No other cluster is started or modified. Private count/original-column digest evidence stays outside Git.

Local verification:

- 99 focused unit/contract cases pass with CI Bun 1.3.14, including queue/rebase/reload/scoping, sender validation, actual HTTP bridge, staged developer admission and docs contracts.
- 66 browser-command cases pass across all six Chromium phone profiles, including lost replies, stale ACK reads, account/owner teardown, offline writes, unknown exact retry and terminal rejection → failed read → reload → fresh review → explicit cancellation. No full e2e was run.
- Actual PostgreSQL rollback and separate two-session synthetic race tests pass: exact accepted/rejected delivery, partial mutation rollback, immutable terminal replay even when predicates become valid, removed-collection replay, membership/source/billing denial, both orders of non-key partnership-owner races, cancellation during lock wait, and rollback of uncommitted terminal results. The archive rollback test also passes on exact compiled 088 definitions, verified against the parent's reviewed definition hashes, followed by twice-applied 089.
- All 90 archived table counts and 35 original-column digests match after fixtures; archive hash is unchanged. Existing helper bodies, owners/ACLs and table ACL/RLS remain unchanged; the added helper stays denied to all runtime roles. The service gateway's deadline remains 10 seconds.
- Final production build, full typecheck and full lint pass; lint retains the existing 55 warnings with no additions. The new review flow is rechecked on the final build across all six profiles.

Parent review of this response slice, authenticated hosted transport/commit-cancellation races, native recovery/Undo, old clients/queues/service worker, representative conversion and all #379 rollout gates remain separate acceptance. Issues stay open. Release text is unpublished.

## Parent application evidence

Applied only089 after verified088 at2026-11-10 00:48:22 UTC, sourceSQL SHA256 `cc91e232b57b778f06f01aeb39c233b271d26437148965084a66093cdd665ed1`. Fresh full archive restored before application, SHA256 `7686e1034608b2f9c06f26f9c1f5f5bf08f42b98e180d789fc8d93e78ce144f4`; all earlier archives retained. Parent verified all90 table counts/35 core digests, existing function owners/ACLs, table/column privileges and RLS, billing role reads, protected recorder/recovery definitions and private executor denials. New helper remains denied to all runtime roles, gateway service-only with unchanged10-second deadline. Native tables empty, zero conversions and no hosted command executed. Local twice-application and exact088-definition proof are separate from the child's actual SQL/race proof and the remaining hosted transport acceptance.

## Additive native recovery terminal contract

Migration 092 prepares recovery-specific noncommit proof through the existing apply v1/v2 gateway/ledger. 089 command proofs are never inferred for recovery. See [terminal noncommit](native-activity-recovery-ui.md#terminal-noncommit-092) for the strict sanitized HTTP/REST/MCP contract, retained outer locks, explicit discard and fresh-preview requirements. Unknown outcomes remain exact retry only. No admission, hosted application or enabled release is claimed.
