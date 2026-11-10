# Auth account deletion with native storage

Migration `099_auth_account_native_cascade.sql` fixes the deferred placement check during the existing account cascade on PostgreSQL 17. It adds no app, REST or MCP operation. Account deletion continues through the existing Supabase Auth admin operation.

This is a narrowly proved fix, not a claim that issue #511 or production account deletion is fully verified. In particular, fresh-schema converted-source ordering exposes another existing guard failure described below. Parent owns release, fresh backup, migration application and the actual Auth endpoint check. No hosted access or application was performed in this lane.

## Observed production facts

The parent completed 56 production native app/REST checks using labelled disposable fixtures. Auth admin deletion worked for an empty fixture but returned an unexpected database failure for a fixture with native slots, copies and Activity. Deleting the exact fixture through the operator connection, including `SET CONSTRAINTS ALL IMMEDIATE`, succeeded in a rollback-only transaction. The parent subsequently removed only the metadata-and-email-guarded synthetic accounts through the operator connection and verified their owned rows were gone. This cleanup was not proof of the normal Auth cascade.

The saved read-only evidence showed `supabase_auth_admin` with `NOINHERIT`, no RLS bypass, SELECT/DELETE on `auth.users`, and neither SELECT nor DELETE on the public binder/native/Activity tables. Both candidate trigger functions were invoker-only, owned by postgres and pinned to an empty search path. Hosted `SET LOCAL ROLE supabase_auth_admin` was itself forbidden, so there is no hosted trigger stack trace.

## Local diagnosis and change

A private restore retained the archive's actual Auth table ownership and ACLs. The test connects locally and uses `SET SESSION AUTHORIZATION supabase_auth_admin`; it asserts the session identity, role attributes, Auth access and public-table denials. No application connection credentials or hosted mode are accepted.

On PostgreSQL 17.11, using the reviewed 097 source on the schema-096 archive:

1. With the original invoker placement function, the Auth-role DELETE statement succeeds. `SET CONSTRAINTS ALL IMMEDIATE` fails with SQLSTATE `42501`, `permission denied for schema public`, in `public.check_slot_placement_v1()`. The failed deletion is rolled back.
2. Changing only that trigger function to `SECURITY DEFINER` lets the same restricted Auth session flush constraints and commit deletion of native collections, converted legacy source, copies, slots, placements, Activity and the actor's lifetime ledger. The unrelated owner's complete fixture remains identical.
3. `guard_storage_authority_v1()` stays invoker-only. Its immediate FK cascade succeeds with the faithfully restored table ownership; changing its mode is unsupported by this reproduction. `collection_audit_private.immutable()` also remains unchanged.

099 contains one `ALTER FUNCTION` in a transaction with a three-second lock timeout. It changes no body, owner, search path, EXEC ACL, table grant, RLS policy, trigger, recovery rule or billing rule. The trigger function cannot be called as an ordinary RPC. Existing source uses qualified names and an empty search path; deployment must verify its trusted postgres owner first.

The default local PostgreSQL 18.4 did **not** reproduce the failure. PostgreSQL 18 preserves the role that queued a deferred trigger, unlike the PostgreSQL 17 behavior relevant here. Do not use a passing PG18 baseline as evidence that the PG17 defect was absent. See the [PostgreSQL change record](https://commitfest.postgresql.org/patch/4888/) and [PG18 trigger documentation](https://www.postgresql.org/docs/18/trigger-definition.html).

## Proof and limits

The original archive SHA-256 is `8d49be2d59b58f3dbef7ad87d44f5947af23ae73677d4002848046113af2eb3b`. Its schema is 096. The locally applied 097 SHA-256 is `8f8dfe61daac520070a434419ee5649f93afac5f9981b528d1d24a13c2affc69`.

- Two applications of 099 preserve 91 original table counts and 35 original critical digests. Only the placement function's security mode changes; its body, owner, search path and EXEC ACL remain identical. All 115 other compiled functions, table/column access, RLS, policies, triggers, schemas, default ACLs and roles remain unchanged.
- All private audit helper EXEC access remains denied to anon, authenticated, holo_mcp and service_role. The 096 fence stays false. No fixture or real collection is converted by applying 099.
- Invalid placement removal, direct authority deletion/reset and cross-owner placement changes still reject. Enforced free-binder billing still rejects an over-limit insert; test configuration and licence changes are rolled back. Activity UPDATE/DELETE still reject while the owner exists. A real nested FK cascade from a separate synthetic parent also rejects Activity deletion while `auth.users` still contains that owner, so trigger depth alone grants no exemption.
- The complete fresh sequence through 097 plus 099 replays on PostgreSQL 17, and 099 is rerun twice. Native-only Auth account deletion commits with unchanged unrelated owner state.
- **Fresh converted-source deletion is still blocked:** fresh FK creation order cascades `pokemon_collection` before `binders`. The unchanged `guard_legacy_binder_write_v1()` sees the still-present converted binder and raises `55000 binder_converted_requires_slot_commands`, even though the Auth parent has been deleted in the transaction. The test explicitly asserts this rejection and retained account. Local fixture cleanup deletes that synthetic binder first; this workaround is not counted as Auth deletion proof. Resolving it requires a separately authorized, genuine deleted-account condition, not a trigger-depth bypass or broad grants. It is outside this function-mode-only change.
- Existing 097 SQL recovery controls also passed on an isolated clone: the 1,025-slot/2,050-copy restore, generated inverse and original-receipt replay; and actual failed COMMIT discarding provisional accepted/rejected ledger rows. Only local connection configuration was adapted in temporary test copies; applied migrations and committed regression sources were not edited.
- 098 was unavailable and belongs exclusively to another lane. No combined 098+099 proof is claimed. Actual production runs PostgreSQL 17.6; this lane's faithful local restore runs 17.11, not the hosted Auth service.

Private proof files are under `/Users/cal/.local/share/holofolder/auth-delete-099-local/`: `preservation-proof.json`, `archive-role-proof.log`, `fresh-role-proof.log`, `fresh-replay.log` and the before/after function/security snapshots. They contain no new hosted access; private data snapshots must stay out of Git.

## Reproduce the real-role proof

Use a dedicated PostgreSQL 17 cluster owned by the test operator, a Unix socket at `/Users/cal/.local/share/holofolder/auth-delete-099-local/s`, port 55699, no TCP listener, and postgres as local administrative role. Do not reuse another lane's cluster. Restore the baseline archive **with ownership and ACLs**, create prerequisite roles/extensions, and apply reviewed 097 locally first. `auth.users` must belong to `supabase_auth_admin`, with the recorded NOINHERIT/NOBYPASSRLS attributes and public-table denials. A no-owner restore or a postgres-only DELETE is insufficient.

```sh
AUTH_DELETE_TEST_SOCKET=/Users/cal/.local/share/holofolder/auth-delete-099-local/s \
  bun test tests/auth-account-delete-sql.test.ts

# In a separate fresh database after replaying documented bootstrap through 097 and 099:
AUTH_DELETE_TEST_SOCKET=/Users/cal/.local/share/holofolder/auth-delete-099-local/s \
AUTH_DELETE_TEST_DATABASE=holofolder_fresh_099 \
  bun test tests/auth-account-delete-sql.test.ts
```

The test commits synthetic fixtures and temporary invoker-mode negative controls in these explicit private databases. Run it only in an isolated disposable restore. It never accepts a hosted URL. A passing fresh test explicitly records the converted-source blocker, rather than treating expected rejection as successful account deletion.

## Parent release gates

Keep #511 open. Resolve the fresh converted-source guard blocker before claiming complete account-lifecycle support. Review the exact combined 098 and 099 sources, run the combined fresh replay and restricted-role fixtures, then take a fresh restore-verified hosted backup. Apply required unapplied migrations in numeric order, 098 before 099, with their reviewed hashes. Verify postgres ownership, empty search path and unchanged function ACLs before and after application.

Finally create a new exactly labelled disposable account through actual Supabase Auth, populate native slots/copies/placements/Activity and relevant recovery receipts, delete it with `auth.admin.deleteUser`, and verify committed removal of all exact fixture-owned native/source/history/ledger rows plus unchanged unrelated owner data. Include a converted-source fixture once its blocker is resolved. Do not substitute operator DELETE, a rollback-only transaction or local SET ROLE for that endpoint gate. No old-client rollout infrastructure or public release announcement is part of 099.
