# Creation and arrangement terminal noncommit, staged 093

Related: #384, #365, #363, #376, #379. This backend slice does not complete those issues. Migration 093 is reserved exclusively for this slice; applied 073–092 are immutable. Parent review, fresh hosted backup/application and release remain separate gates. No hosted data, conversion, enablement or publication was performed here.

## Authoritative transaction

`collection_audit_private.execute_creation_import_v1` wraps the existing 083 creation and 088 arrangement engines through `storage_execute_v1`. Current authenticated source, actor, membership and billing checks still precede replay. Membership is upgraded to SHARE and re-resolved before owner locks, including after waits. Recipient membership remains locked while importing partner-attributed wants. Outer management 6102 then root 4701 transaction locks survive the inner engine exception rollback.

| Family               | Original permanent ledger namespace           | Digest, unchanged                                                     |
| -------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `collection.create`  | `collection_create_v1`, actor + operation ID  | SHA256 of PostgreSQL jsonb text `{owner,request,context:ctx}` in UTF8 |
| `backup.arrangement` | `backup_arrangement_v1`, actor + operation ID | The same original owner/request/context construction                  |

The wrapper looks up the original accepted/rejected receipt before mutable state, catalog, copy, placement or private evidence reconstruction. Original engine accepted responses, context fields, source/credential/actor/owner binding and expiry `infinity` are unchanged. Engine-level lookup remains for compatibility with existing internal callers. Changed body/version/source/client/recipient cannot reuse a receipt; a different actor has a distinct ledger key and cannot borrow another actor's receipt. Cross-actor accepted operation identity still uses the original audit guard.

Only these dedicated engine predicate states can become terminal rejection. Message text does not select the public reason:

| SQLSTATE | Public reason                      | Family      |
| -------- | ---------------------------------- | ----------- |
| `HF931`  | `inventory_revision_conflict`      | Both        |
| `HF932`  | `creation_identity_conflict`       | Creation    |
| `HF933`  | `inventory_collection_conflict`    | Arrangement |
| `HF934`  | `arrangement_destination_conflict` | Arrangement |
| `HF935`  | `import_copy_conflict`             | Arrangement |

After the complete inner engine subtransaction rolls back, the outer wrapper requires an actual native owner revision and writes a rejection to that same ledger. Missing native owner state cannot produce terminal proof. [098](empty-owner-first-creation.md) permits prospective revision 0 for first creation only after proving the owner empty under the existing locks; import keeps its original missing-state rejection. If the inner creation rejects before a root exists, the wrapper returns unavailable without a ledger entry. Existing-root terminal outcomes are unchanged. Exact replay returns the historical accepted/rejected result forever after later edits, deletion or recovery, without reacquiring copies or creating a collection again.

Arbitrary `40001`/`23505` errors, including identical message text, helper conflicts without a dedicated predicate state, cancellation, audit/constraint/COMMIT failure, invalid input, access/billing denial and network failure do not produce proof. A result seen before failed COMMIT is not durable. Lost replies require exact original replay; do not refresh revisions or issue a new ID to escape an unknown result.

No table, grant, deadline, cap, evidence limit or conversion bypass is added. Creation default/order/count/grid rules and import copy/placement/want/cap/frozen-evidence rules remain in the existing engine and transaction. 089 command wrapping, 090 private patches, 091 insertAssign, 092 recovery, full recorder/recovery and legacy 087 are preserved.

## Consumer contract

The authoritative shared bridge validates each family using `lib/collection/creation-import-rejection.ts`. Strict guards accept exactly four fields and known family codes, with the original operation ID and a nonnegative safe inventory revision. They are shape guards for a trusted response, not standalone client proof, signatures or authentication.

After future admission, the shared developer adapter creates typed `StorageCreationRejectedError` / `StorageImportRejectedError`. REST returns 409; MCP returns `isError:true`, matching text and structured JSON. Example synthetic error:

```json
{
  "error": {
    "code": "storage_creation_rejected",
    "message": "The original creation did not commit. Read current storage before explicit reconciliation.",
    "requestId": "synthetic-request",
    "rejection": {
      "outcome": "rejected",
      "operationId": "synthetic-original-operation",
      "code": "inventory_revision_conflict",
      "inventoryRevision": 7
    }
  }
}
```

Import uses `storage_import_rejected` and its declared message. No private context, owner identity, certificate, label asset, frozen evidence or receipt-internal field is returned. Registry `errorSchemas`, generated OpenAPI/reference/Markdown/LLM exports and MCP status-keyed `holofolder.com/errorSchemas` describe these errors. Success `responseSchema` / MCP `outputSchema` describes accepted receipts only.

A first-party consumer must retain the immutable request and bind a trusted returned proof to the original operation family, request/delivery and original authenticated session/owner scope. On owner/session change it must retain the unresolved request for reconciliation. A generic HTTP 409, matching message, SQLSTATE, missing receipt, reconstructed proof object or shape guard alone never permits discard. After valid proof, obtain a fresh authoritative complete current read in that same scope, then require explicit discard or review and confirmation of a new intent with a new operation ID. Discard is distinct from acceptance/synchronization; preserve original intent/proof. Redacted developer pages with `completeSnapshot:false` do not provide this complete-read authority.

**Creation consumer integration is staged in [the durable device host](durable-copied-preset-creation.md).** It consumes this shared proof/error contract with original request/delivery/auth binding, a fresh complete read and explicit retained discard. Arrangement import consumer integration remains separate. The original 093 backend lane did not edit the device queue or UI. Production native REST/MCP admission remains fixed `503 native_operations_staged` with zero executor calls. No request flag enables it. This is internal preparation, not a customer release.

## Local evidence and handoff

The opt-in `tests/creation-import-terminal-sql.test.ts` accepts only this lane's private local Unix socket and port 55593, never a hosted URL. Synthetic transactions cover old accepted engine receipt compatibility, exact permanent rejection replay, changed intent/actor/source/recipient, current membership, two-session accepted/rejected races, retained locks, cancellation during mutation, rollback, deferred recorder failure and failed COMMIT, RLS, default and safety limits, duplicate physical copies, frozen conversion evidence and recovery with zero repeated acquisitions. `tests/native-developer-operations.test.ts` exercises actual REST/MCP adapters and SDK output validation with synthetic auth/PostgREST dependencies; real fixed admission proves zero executors, and a test-only module mock exercises future forwarding/errors. No live fixture or API smoke is used.

A fresh schema replay uses synthetic Supabase platform scaffolding, not a full Supabase installation. The private pre-092 archive is restored to an isolated local cluster, its 90 counts/35 critical digests and ACLs checked, reviewed 092 applied before 093, then 093 applied twice with unrelated compiled functions, ACLs and RLS compared. No private rows, inventory hashes, certificates, tokens or archive bytes belong in the PR.

Maximum local synthetic workloads use 4096 creation slots and an arrangement with 4096 slots plus 5000 explicit added copies, including unassigned copies. Timings include deferred audit flush and are recorded in test output; the SQL deadline stays 10 seconds. Local timings do not establish hosted contention, production latency or a larger bound.

Parent must review the final head, refresh the hosted backup, apply only reviewed unapplied migrations in order, verify data/ACL/RLS/compiled functions and production deployment, and retain the separate arrangement-consumer and #379 admission gates. No merge/watch/publication is authorized for this implementation lane.

Local verification on 2026-11-10: pinned Bun 1.3.14 unit suite 1584 passed / 53 opt-in skipped; opt-in 093 PostgreSQL suite 11 passed; fresh-schema replay passed; typecheck passed; lint passed with the existing 55 warnings; production build and linked docs CSS check passed using synthetic Supabase configuration. The bounded run measured about 0.5s creation and 2.7s import including audit flush, with roughly 25ms replay / 34ms rejection locally. No full e2e, hosted apply, live fixture/API smoke or production verification was run. These checks do not establish the separate consumer integration or parent acceptance gates.
