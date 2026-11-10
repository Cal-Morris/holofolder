# Direct native server handoff, #379 / #376

Server/API lane only. No migration added, SQL grants changed, operator conversion/provision added, hosted writes performed, app host enabled, or production acceptance claimed. Base: latest origin/main at implementation start. Parent reports PR505 merged as ef70ddebb292fcceed5b56f2cdbf36ca3948e762 and migration 097 applied/verified hosted, preserving 91 table counts, 35 digests and access rules. No 098 reservation is needed. GitHub reported a merge conflict after the initial push, so this branch was rebased onto that exact main merge and verified again.

## App lane contract

All URLs include `/app`. JSON responses are `Cache-Control: private, no-store`, first-party responses vary on Cookie. The production routes call the same existing trusted bridges as the synthetic harness, with no runtime flag or caller-selected clients.

- `GET /app/api/inventory?requestId=<id>&sessionId=<device epoch>` calls the cookie/RLS complete reader. Both IDs are required exactly once; no other query fields are accepted. It returns the existing version-2 envelope with snapshot, navigation, scope, evidence, partner and optional unique default collection. Neither ID authenticates or selects an owner. Missing root remains `inventory_not_initialized`; mixed legacy state remains an honest error. Do not replace this with an admin snapshot.
- `POST /app/api/binder-slots` sends the canonical slot command; `POST /app/api/inventory` sends the canonical inventory command. `GET` on binder-slots and PATCH/DELETE are unsupported, with framework 405 responses. Read slots through the complete inventory envelope.
- `POST /app/api/storage-collections` sends canonical `CollectionCreationCommand` version 1. Headers: JSON Content-Type, app Origin, `X-Binder-Owner`, `X-Binder-Auth-Session`, `X-Storage-Operation` matching the body, and optional expected `X-Binder-Actor`. Retain `X-Storage-Delivery` for creation terminal-response binding. The same headers apply to slot/inventory writes. Server derives actor and audit source from cookies, not the body.
- `POST /app/api/native-recovery?operation=recovery.preview|recovery.apply|recovery.preview.v2|recovery.apply.v2` retains the existing canonical inputs and version-1 response envelopes. Requires Origin, current owner/auth-session headers. Apply replays original operation IDs.
- `POST /app/api/raw-content-restore` retains the existing plan/delivery contract. Requires Origin, JSON, current owner/session plus `X-Storage-Operation` and `X-Storage-Delivery`. Plan reads through RLS; retained original delivery goes to the lifetime ledger before mutable reconstruction. Existing V1/V2 envelopes and bounds are unchanged; V3 reorder restoration from #505 retains exact stable-ID before/after permutations, receipt binding and the same bounded envelope.

Accepted command envelope: `{version:1,operationId,receipt}`. Slot/inventory terminal rejection: `{version:1,operationId,rejection}` with 409. Creation uses the existing `error.rejection` envelope and operation/family/delivery headers. Keep existing transport parsers; a generic 409 is never discard proof. Get a fresh complete current read after the response before reconciliation or queue acknowledgement.

## First/default creation needs no new SQL

Migration 083's `collection_audit_private.create_collection_v1`, extended by 084/085/093, already handles an owner with zero binders and no inventory root. It checks expected `inventoryRevision:0`, inserts the root in the same transaction, creates all copied slots/manifest atomically, and sets `is_default` when binder count is zero. Invoke it only through the authenticated route above and `storage_execute_v1`, never by granting access to the private helper. Keep operation/collection/slot IDs and the exact request across retries. Existing plan caps/grid checks and canonical target validation still apply.

For onboarding, an authenticated app can explicitly create the first native collection using that path without first calling legacy ensure-default. A failed complete read is not proof of an empty account: the app/bootstrap lane must establish the empty account state from its trusted bootstrap, handle existing legacy owners through parent conversion, and retain unknown outcomes. This lane does not provision or automatically convert accounts.

## Developer contract

The existing dispatcher now admits the supported native command/recovery/raw restore, redacted read and copied preset operations through actual key/OAuth authentication. Both write permissions remain required; recovery also needs collection read. Native reads and preset previews recheck credential, membership and billing at final fences. Preserve-mode expected owner is checked before SQL; raw restore binds original actor/owner/credential scope. SQL keeps the original audit attribution, current authority, CAS and lifetime replay. No private-helper grants or browser service-role snapshots are added.

Unsupported preset set/master-set scope, unsupported restore/recovery evidence, mixed/uninitialized inventories and legacy analytics remain honest errors. Native analytics is still unsupported by the legacy analytics endpoint.

## Proof and remaining parent work

Parent reports a rollback-only conversion rehearsal for all 11 binders across 7 owners, preserving 691 owned, 485 wanted and 1,058 source rows, with repeated receipts, constraints and audit flush verified, maximum 4.576 seconds. Zero conversions were committed. These are parent-supplied facts, not child-hosted verification. Parent will commit conversion after both app and API paths can consume the result; no old-client fence activation is required.

Focused synthetic tests exercise the real production route exports, trusted bridges, actual REST and MCP HTTP/SDK paths, auth/permission/billing denial, exact replay, unknown outcomes and private projection. They do not prove hosted migrations, conversion, request payload limits, offline device ACK or production execution.

The hosted API smoke runner no longer sends old denial-only native write sentinels. Until it has a reviewed native fixture lifecycle it reports those operations uncovered and exits unsuccessfully, rather than treating historical fixed-503 samples as execution proof. Parent owns backup, SQL application, conversion, hosted/device proof, merge, completion and Framer. No full e2e was run.

## Local verification

- 81 focused tests passed across 21 server/transport/domain test files after the conflict-required rebase, including v3 raw restore, including actual REST/MCP SDK paths and production route exports with synthetic cookie/auth/backend dependencies.
- `bun run typecheck` passed.
- `bun run lint` passed with the existing 51 warnings, no new warnings.
- `git diff --check` passed. Generated OpenAPI was regenerated and its schemas checked by the focused tests.
- No full unit suite, build, browser/e2e, hosted SQL, conversion, deployment or production checks were run by this lane. Docs browser assertions were updated to the current API contract but not executed.
