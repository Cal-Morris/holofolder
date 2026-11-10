# Native account deletion (099)

Related: #511, #379. This fixes the existing account-deletion contract; no new API, grant, table, flag or client-selected bypass is introduced.

Production disposable-account Auth deletion failed after native storage edits. Operator deletion of the same labelled fixture succeeded in a rollback-only transaction. PostgreSQL 17 role-faithful proof reproduced deferred `42501` in `check_slot_placement_v1()` under `supabase_auth_admin`, which owns `auth.users` but has no native-table access. PostgreSQL 18 changes deferred-trigger role propagation and cannot substitute for this reproduction.

## Narrow changes

- `public.check_slot_placement_v1()` becomes `SECURITY DEFINER`. Its body, trusted postgres owner, empty search path and EXEC ACL remain unchanged. Only its existing consistency checks run with their owner's table access.
- `public.guard_legacy_binder_write_v1()` permits DELETE when the row has a non-null referenced user ID and that actual Auth account no longer exists. All other insert/update/delete behavior, frozen-restoration handling, binder locks, ownership, search path and EXEC ACL remain unchanged.

The second change handles fresh-schema FK ordering, where Auth's `pokemon_collection` cascade can run before its `binders` cascade. The original binder-absence condition alone rejected genuine account deletion. Parent-account absence is checked directly; trigger depth, caller flags, a nested non-account cascade and a missing user ID cannot establish this exception. While the Auth owner exists, ordinary deletion/update of converted legacy rows still rejects.

No runtime role gains table access, private helper execution or history mutation. The authority guard is unchanged. Account deletion removes the deleted owner's data; unrelated owners remain unchanged. Public account-deletion semantics are unchanged, so no REST/MCP/OpenAPI operation is added.

## Evidence

The original one-function draft passed archive ordering but deliberately recorded a fresh converted-source failure. Those original logs are retained privately. The corrected migration passes both orders with native and converted storage together, rather than counting expected refusal as deletion success.

Parent's private PG17 proof lives at `/Users/cal/.local/share/holofolder/auth-delete-099-local`, socket `s`, port 55699, role postgres. Source tests validate this exact private socket and server major version; never point them at hosted credentials.

```sh
AUTH_DELETE_TEST_SOCKET=/Users/cal/.local/share/holofolder/auth-delete-099-local/s AUTH_DELETE_TEST_DATABASE=preserve099 bun test tests/auth-account-delete-sql.test.ts
AUTH_DELETE_TEST_SOCKET=/Users/cal/.local/share/holofolder/auth-delete-099-local/s AUTH_DELETE_TEST_DATABASE=holofolder_fresh_099 bun test tests/auth-account-delete-sql.test.ts
```

Corrected local proof includes:

- Fresh archive restore, reviewed 097 and 098, twice-applied 099, all 91 original table counts and 35 digests unchanged. Only placement execution mode and the legacy account-cascade predicate change; other definitions, owners, EXEC ACLs, table/column privileges, RLS, policies, triggers and default grants remain unchanged.
- Fresh numbered schema replay through 098 and 099, plus restricted Auth-session COMMIT for native and converted-source fixtures in both schema orders. Copies, slots, placements, frozen mappings, history and actor receipts cascade; unrelated owner snapshots remain identical.
- Negative placement-role control reproduces the original deferred failure. Invalid consistency/authority/cross-owner changes, ordinary converted legacy writes, billing overflow and immutable-history writes remain rejected. A nested non-account parent cascade cannot erase history while the actual account exists.
- No private helper becomes executable by anon, authenticated, holo_mcp or service_role. The inactive 096 fence remains false. Direct trigger calls remain rejected.

Local role proof is not actual hosted Auth-service acceptance. No full e2e or physical-device claim is made.

## Parent release sequence

Review the exact corrected head and SQL hash. Preserve all previously applied migrations; only unapplied 099 may change before application. Use the fresh restore-verified backup, confirm reviewed 098 is installed, apply only 099, then compare contents, the two intended function changes, ACLs/RLS/billing and protected definitions.

Verify actual disposable-account `auth.admin.deleteUser` for native and converted storage, exact fixture cleanup and unrelated-owner preservation. The earlier operator-only cleanup is not a normal Auth success. Merge/deploy under the repository policy; keep #511/#379 open until hosted evidence is complete. Do not convert real collections before the required app/backend flow is usable. No customer-facing capability announcement is warranted for this internal defect repair.
