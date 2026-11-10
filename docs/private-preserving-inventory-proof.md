# Private-preserving inventory, local proof and parent handoff

Related: #376/#383. This is a staged backend contract, not enabled product behavior.

## Supported contract

The existing inventory operation accepts `patchGrading` for nonempty public-field patches on an already graded card, and `fulfillWant:{index,expectedPublic}` for assignment/move of exactly one selected want. [Current help](../content/docs/native-storage.mdx) defines fields, omission/clearing and exact preconditions. `privateFields:preserve` permits these forms; full grading/wanted-list replacement remains explicit and compatible. No new operation, scope, grant, ledger, history store or provider access is added.

090 patches the installed inventory executor after existing audit/large-delete/conversion integrations. Its lifetime ledger hashes the original request/owner/trusted intent and resolves exact replay before mutable revision checks. Only local command variables are reconstructed, after locks. The canonical caller request remains unchanged. The existing service-only gateway returns sanitized committed receipts, with the unchanged 10s executor deadline. A transport timeout does not establish noncommit.

## Real private PostgreSQL proof

The retained pre-088 archive SHA-256 was independently verified as `123383c5bba50e057de540d619f066456b223a0b859b3878ddd8ef0b2803f473`. A new local cluster on this lane's socket/port restored the archive including ACLs without changing its original files. All 90 archived table counts and 35 core digests matched before applying reviewed 088. 090 was then applied twice. Existing local table ACLs/owners/RLS flags and all other public/private function definitions/ACLs matched. The restore remaps object ownership to the isolated local verifier; hosted owner/ACL verification remains the parent's gate. The inventory executor's existing ACL and 10s timeout remained unchanged.

`tests/private-preserving-inventory-sql.test.ts` passed against that actual restored 088 database plus 090. It exercises the real service-only gateway, executor, lifetime ledger and deferred audit recorder:

- A committed grading patch with its reply treated as lost, a later metadata edit by the other authorized actor, and exact replay returning the original receipt without changing later metadata/history/ledger.
- Changed original body, owner, actor and trusted source rejection; current paid access and membership rechecked before replay.
- Three two-connection races: grading versus grading, selected-want fulfilment versus a wanted-list edit, grading versus placement removal. Exactly one committed, the other failed its original revisions.
- One selected duplicate want removed by its exact slot/version/index and complete public preconditions. The other entry's private image/attribution remained unchanged. Incorrect public preconditions rejected, and replay after unassignment did not reassign the copy.
- Omitted certificate/assets/public fields retained, explicit nullable-field clears applied, and immutable provenance/acquisition time preserved. Private patch keys rejected.
- Late batch failure, deferred audit failure at COMMIT, and saved-card allowance failure all rolled back state, revisions, ledger and audit together.
- Owner/partner private reads still work under authenticated RLS; strangers see no row and authenticated direct writes remain denied. Runtime roles still cannot execute the mutable private executor.
- Existing recovery preview explicitly returned unsupported `private_assets_unverifiable` for the private-label-asset event. No universal inverse/Undo claim is made.

All original row hashes across the 90 restored tables were checked again after the successful proof: no original row changed or disappeared. Synthetic proof additions remain in the private scratch database. Public repo tests contain synthetic data only.

Private retained evidence directory: `/Users/cal/.local/share/holofolder/issue376-parity-090`. Successful proof database: `parity090_6`, user `parity_test`, port `55590`, socket `.../issue376-parity-090/socket`. Original-row hash material and restore logs stay private. The cluster may be stopped after verification; its data directory remains there. Do not target another worker's cluster.

To repeat, use a **new** isolated database restored from the retained archive, verify the 90 counts/35 digests, and apply reviewed 088. Then run the exact pinned binary, not `bun run test` resolving another Bun on PATH:

```sh
PRIVATE_PATCH_TEST_DATABASE=parity090_fresh \
PRIVATE_PATCH_TEST_SOCKET=/Users/cal/.local/share/holofolder/issue376-parity-090/socket \
/Users/cal/.local/share/holofolder/toolchains/bun-1.3.14/bun-darwin-aarch64/bun test tests/private-preserving-inventory-sql.test.ts
```

The test commits synthetic fixtures to prove history and real concurrent sessions, so each repeat needs a fresh database. It refuses another socket or a database outside the `parity090_` prefix.

## Other proof tiers

Pinned Bun 1.3.14 directly: **1519 passed, 35 environment-gated skips, zero failures** in the full unit suite. This includes strict domain/input checks and actual REST/MCP SDK handler/shared-dispatcher forwarding tests with synthetic intercepted adapter dependencies. These complement the real SQL proof, not substitute for it. Affected source lint has zero warnings; full lint passed at the existing 55-warning cap. Full typecheck and production harness build/docs CSS passed.

The affected help/generated inventory reference passed the six phone browser/standalone cases at 375, 390 and 430 px, with standalone safe areas and no horizontal overflow. The test also verified Markdown, staged OpenAPI/discovery, and the two new intent schema forms. No full e2e suite, hosted authenticated request or physical installed PWA proof was run. No fresh-schema replay or hosted timeout/load proof is claimed.

## Integration and application gates

090 was proved **independently on reviewed 088**, with prerequisite #462 source `cbc42726e121a028cbb5a7a99ae7b3bab7ca8695` integrated locally. #462 merged during implementation. This lane did not edit/add 089 or applied 073–088.

Actual pending 089 source at `3c0711b4ea26627adf84f387811875ea86b7ea38` (`scripts/089_storage_command_rejection.sql`, PR #463) was read: it wraps the gateway's command dispatch and keeps the original inventory executor. No combined 089+090 execution proof is claimed. Its terminal rejection receipts differ from 088 SQL exceptions. Parent must preserve both lanes' request/response contracts and test the actual combined source, including explicit rejected outcomes and both migrations applied twice. Do not infer noncommit from a generic HTTP status or silently drop 089's wrapper when integrating.

Parent owns independent exact-head review, fresh restore-verified backup, numeric application of required unapplied migrations (089 then 090), hosted ACL/data verification, serialized merge and production deployment verification. Before 090 application, new SQL forms are unavailable; existing forms remain compatible and the public native gate stays unconditional 503. There is no runtime override, conversion, Framer publication or spending here.

Concrete remaining gates: combined 089 integration/proof; hosted 090 application; existing private-assets inverse recovery; first-party/offline durable original-recipient reconciliation and fresh complete-read ACK; other #376/#383 acceptance and #379 admission. The developer read projection remains incomplete and cannot satisfy planner/queue evidence. Issues remain open. [Unpublished release copy](releases/private-preserving-inventory-draft.md) is prepared for the parent feature block.
