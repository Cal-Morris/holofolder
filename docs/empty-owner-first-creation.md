# Empty-owner first creation (098)

Migration `098_empty_owner_first_creation.sql` fixes the actual hosted first-collection regression introduced by 093: a valid version-1 blank manifest, 3×3 grid and no slots at inventory revision 0 reached `storage_owner_state_unavailable` before 083's root INSERT. The failed request committed no binder or receipt. Parent's disposable initialized-root API checks established that the later path works; initialization is not the onboarding fix.

## Contract

The existing service-only `storage_execute_v1('collection.create', owner, request)` gateway, trusted actor context, current membership/billing checks, lifetime namespace/digest, limits and 10-second budgets remain unchanged. No operation, table, protocol, grant or client-selected authentication is added. REST/MCP use the same existing command contract; no registry or generated OpenAPI changes are needed.

Only `collection_audit_private.create_collection_v1` and `collection_audit_private.execute_creation_import_v1` definitions change. All 073–097 source bytes and the installed 097 gateway/import/recovery/raw-restore helpers remain unchanged.

Under existing membership SHARE and owner advisory locks (6102 then 4701), a missing root may mean prospective revision 0 only if the owner has no `binders`, `pokemon_collection`, `storage_collection_state`, `binder_slots`, `inventory_items`, `inventory_placements`, `binder_legacy_rows` or `collection_activity`. This includes empty legacy binders, historical activity and mixed/corrupt residue. It never converts legacy data or invents an inventory root for an existing owner.

The original engine still validates the request, copied targets, identities and caps before its root INSERT. Root, first default, copied targets, audit and accepted receipt commit together. Invalid requests, cap/recorder/constraint failures and rollbacks commit no partial root/default/ownership. Exact accepted retries return the original receipt without a second default, target copy or acquisition. A concurrent stale creation waits on existing locks, then receives the unchanged existing-root terminal conflict.

If a dedicated 093 predicate fires before a root exists, the inner work rolls back and the wrapper reports `storage_owner_state_unavailable` (`55000`, mapped to `503 storage_unavailable`), with no terminal receipt. Retain the original request and operation ID; unavailable is not discard proof. The wrapper never fabricates a revision or bootstraps a root to mint rejection evidence. Existing-root dedicated predicates and arrangement import predicates are unchanged. Current authority still precedes accepted/rejected replay.

## Local proof

Use only the private socket `/Users/cal/.local/share/holofolder/onboarding098-local`, port 55598, user `onboarding098`. These opt-in tests never use environment database credentials or hosted connections:

```sh
EMPTY_OWNER_CREATION_TEST_SOCKET=/Users/cal/.local/share/holofolder/onboarding098-local bun test tests/empty-owner-first-creation-sql.test.ts
```

Use pinned Bun 1.3.14; Bun 1.3.12 incorrectly runs skipped SQL cases. Commit/race proof additionally requires `EMPTY_OWNER_CREATION_TEST_DATABASE=holofolder_fresh_onboarding098`, a disposable synthetic database created by fresh-schema replay. Do not run committed fixtures in the restored archive database. The committed test intentionally leaves its synthetic rows for inspection; drop/recreate that database before repeating.

Proof uses parent's immutable pre-097 archive `2026-11-10T08-52-59Z-before-097/hosted-db.dump`, restores ACLs and applies exact 097 SHA256 `8f8dfe61daac520070a434419ee5649f93afac5f9981b528d1d24a13c2affc69` before 098. Twice-applied 098 preserves 91 original table counts, 35 core digests, all security metadata and 216 protected function definitions. Only the two intended helpers change, with owners/ACLs/configuration unchanged and all runtime roles denied direct helper execution. Private archive/data/function/security reports stay outside Git.

Actual service-gateway tests cover blank first create, copied targets, exact replay, stale and identity conflicts without absent-root proof, malformed/unknown requests, individual legacy/native/source/history residues, recorder/deferred constraint rollback, free grid limits, actor/partner/owner/billing scopes and authority-before-replay. Fresh-schema replay covers the full numbered setup through 098. The synthetic two-connection test commits first creation and exact replay, observes the competing transaction blocked, then verifies one default/root/audit event and an unchanged replayable stale rejection. The six original 093 creation/import regression cases also pass on the restored 098 database, including current-state predicates, recovery, cancellation, concurrency and membership fences. Focused units (16 passing), typecheck, lint (51 existing warnings) and production build pass. Local SQL is not hosted PostgREST/browser proof. No full e2e, hosted SQL, conversion or publication is performed in this lane.

## Parent application sequence

1. Independently review the exact PR head and 098 SHA. Confirm 097 is installed at the reviewed hash; 099 belongs to the separate Auth cascade lane.
2. Take a fresh hosted backup, privately restore it, compare original data/counts/digests/access/protected functions, and apply only required unapplied SQL in numeric order. Do not replay 073–097 on hosted data.
3. Apply 098 as one transaction, verify precisely the two changed definitions, unchanged gateway/import predicates/ACLs/deadlines and original data. No conversion or owner-root initialization is required or authorized by this migration.
4. Coordinate merge/deployment with the separate 508 complete-read/cached-readonly lane and 509 API metadata lane. This migration does not modify those paths.
5. Verify a real disposable missing-root user's first API creation, exact replay, stale CAS, audit/default/count invariants and cleanup without touching actual user data. Parent owns hosted verification, backup, merge and release. Keep unknown requests retained until authoritative reconciliation.

This is an onboarding regression repair with unchanged public API, not a new capability announcement. No marketing publication is required from this lane.
