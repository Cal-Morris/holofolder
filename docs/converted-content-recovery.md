# Private recovery of ordinary edits after conversion (080)

Related #396/#383, based on main `b90873e9aa7c93089704b0cb921c9317daf15465`. This is an internal compatibility slice. The parent owns review, CI, fresh hosted backup/application, serialized merge and deployment. No hosted access, real conversion, runtime grant, route enablement, Undo/Activity change or Framer publication belongs to this slice. #396/#383 remain open/In Progress. The accepted #395 read-only release wording is unchanged.

## Contract

Installed 077/079 rejected any changed storage root with a conversion receipt as `authority_or_config_transition`. 080 permits a non-null receipt only when both root images exist, authority stays `slots`, and every property except monotonic content/layout counters is identical. It never restores a historical root over the current one. A receipt is provenance, not permission to undo conversion.

The same private SQL preview/apply signatures, plan version and explicit confirmation apply. Evidence comes exclusively from real 076 events. Supported inverses include ordinary item add/edit/grade/removal; assignment/move/swap/unassignment; target/content/want edits; free-slot insertion/removal and reorder, within the existing 074/075 and recovery bounds. Native-to-converted and converted-to-native moves retain the same physical copy IDs. Species-only unknown printings remain species-only; catalog-dependent target validation still uses current catalog evidence. This does not invent a printing or grant unavailable catalog matches.

For each affected converted collection, including the origin of an Unassigned legacy copy, the planner checks the current authority, conversion version/time and **complete** receipt against the installed 073 source-evidence contract. It verifies every frozen mapping's owner, source row, deterministic original slot ID and count against the original `pokemon_collection` rows. It does not compare current ownership/placement counts to the conversion baseline, since ordinary edits legitimately change those counts. Receipt item/placement counts continue to describe conversion time. UTC serialization matches 073 regardless of caller timezone. The planner canonicalizes only typed `inventory_items.acquired_at` and `storage_collection_state.converted_at` fields in its in-memory event copy before comparing current rows. This handles commands and recovery in different timezones without changing persisted history, frozen JSON, or other metadata.

Frozen mapping digests join the existing private dependency fingerprint; original rows and mappings are locked before the two fresh locked plan reads. Current root/receipt/config, item/grade/placement/slot/layout, absent IDs, catalog, membership and allowance checks remain. Later source/config history is scanned completely to catch ABA. Changing an item's `legacy_source` is an unsupported provenance transition. Private evidence and certificates never enter the safe preview. No source rows, frozen mappings, `legacy_source`, preset origins/manifests, binder metadata/grid/defaults, original completion baselines or original events are rewritten by recovery.

080 patches only the installed planner and adds source dependency locks to the installed executor. It requires the 079 inverse-array/layout optimization, 079 slot-key placement lookup and 078 wrapped deletion body. It preserves all three apply plan reads, partnership-before-4701/root locking even for an owner restoring partner wants, finite payload/deadline limits, current authorization before replay, allowance enforcement, atomic 076 recording and a new linked event. No helper, bypass GUC, trigger disabling, index, retention change or grant is added. Native private plans retain identical material when no converted source is involved.

## Required next slices, still open

These are required feature gates, not removed requirements. Unsupported events have no token and cannot restore a subset:

- [ ] Whole converted-collection deletion and frozen-row restoration. A deleted receipt-bearing root remains `authority_or_config_transition`; frozen source/mapping deltas remain explicit `unsupported_table:pokemon_collection` / `unsupported_table:binder_legacy_rows`.
- [ ] Mapped-slot removal with a frozen-source cascade. Current 074/075 can emit this deletion event, but its entire recovery remains unsupported. Unmapped target/spacer removal is supported when layout evidence is complete.
- [ ] Actual conversion undo and authority/storage-kind/config transitions. Preserve installed guards and reject stale legacy writes; no authority reset or dual writes.
- [ ] Mixed legacy default replacement, with lossless legacy/default/billing compatibility.
- [ ] Appearance/config, share/search/push and private label-assets recovery. Keep explicit unsupported reasons; never republish obsolete share tokens or replay old delivery queues.
- [ ] Shared REST/MCP/API permissions/status mapping/docs, Activity linked-event UI, short-lived Undo, offline intent/reconciliation and legacy/guest/import/share/bootstrap compatibility.
- [ ] Service deadlines/cancellation, large valid metadata, memory/load/account-lifetime history and enabled production rollout evidence. The local 10-second statement target is not a service SLA.

There is no public registry/OpenAPI operation to generate for SQL-owner-only functions. App slot/inventory routes retain unconditional private/no-store 503 and legacy production startup remains authoritative. These internal contracts and [API coverage](public-api/coverage.md) ship together; publication waits for the owning enabled feature.

## Local reproduction and evidence

A **new**, private Unix-socket-only PostgreSQL 18 cluster at `/Users/cal/.local/share/holofolder/issue396-converted-local/socket`, port **55580**, owner `converted_recovery_test`, was restored from the pre-079 archive SHA-256 `8ec7baaee62d706e2f353d5735ef309848f1a3b6b9602b76dd4bacf2cfecf307`. It includes 078. Original roles/ACLs and service-role RLS bypass were restored without granting denied executors. Install 079, then 080 twice. Existing worker clusters and the original archive stay untouched. Auth/private data, dumps and logs remain outside Git. This worker stops only its own cluster after final verification; restart it explicitly to reproduce.

Run suites **sequentially**, since they reinstall private definitions and touch synthetic billing configuration:

```sh
COLLECTION_AUDIT_TEST_SOCKET=/Users/cal/.local/share/holofolder/issue396-converted-local/socket bun test tests/collection-audit-sql.test.ts
COLLECTION_RECOVERY_TEST_SOCKET=/Users/cal/.local/share/holofolder/issue396-converted-local/socket bun test tests/collection-recovery-sql.test.ts
COLLECTION_DELETE_TEST_SOCKET=/Users/cal/.local/share/holofolder/issue396-converted-local/socket COLLECTION_RECOVERY_COMPARE=1 bun test tests/inventory-collection-deletion-sql.test.ts
CONVERTED_RECOVERY_TEST_SOCKET=/Users/cal/.local/share/holofolder/issue396-converted-local/socket bun test tests/converted-recovery-sql.test.ts
```

`COLLECTION_CONVERTED_BASELINE=1` skips installation in the new suite: on installed 079 the first real 073-converted/074-cleared event fails the supported assertion with `authority_or_config_transition`. After 080, actual converted commands roundtrip exact semantic state, including duplicate physical copies, unknown printing, certificate/acquisition/provenance, wants/membership, target/spacer/order/preset and custom grid metadata. Tests cover native/converted moves, swaps, new assignment, explicit Unassigned, stale item/grade/placement/slot/layout/metadata, source/config ABA, fake receipt, rejected receipt/authority mutation, mapped removal, converted deletion, wrong owner/revoked member, allowance and recorder rollback, replay and owner-wanted unlink contention. Committed concurrency fixtures are removed through the account privacy cascade; all other fixtures roll back.

The six existing native audit/recovery/deletion cases also pass with 080. On the same 512-later-event native fixture the complete private plans match original 077. The 4,096-copy preview measured about **0.81 s**, apply plus deferred constraints and original audit flush **5.60 s**, both under the unchanged **10 s** invoking-statement deadline. The 1,025 mixed case measured about **0.10 s / 0.42 s**. These are individual local runs, not production/load/memory proof. No timeout was raised to pass candidate recovery; forced 1 ms cancellation still aborts the whole intent.

All 90 archived table counts and 35 original-column digests match after cleanup, archive hash unchanged. Runtime EXECUTE checks remain denied for every staged/private function and all four roles. All **1,303** unit-suite entries, **42** focused cases, typecheck, lint and production build pass with the pinned dependencies (55 existing lint warnings, none added). Full fresh-schema replay through 080 uses the same private socket and a new empty `holofolder_fresh_*` database; its synthetic auth fixture now includes the sessions/OAuth relations required since 060. These scaffolds are not Supabase platform/auth proof. No full e2e applies to this SQL-only hidden slice.

## Parent application

1. Re-resolve the exact PR/main heads, required reviews and checks. Preserve 073–079, especially installed 079 SQL hash `f5a37a5a92b4250e035991e6caaba8a14bafd1fb9db4f4e382a326dc64a3aa31`.
2. Take and restore-verify a **fresh** hosted snapshot and compare current schema, 90 counts/35 original-column digests, billing/ACLs and storage state. The supplied archive is local verification input, not authorization to reuse a stale hosted snapshot.
3. Apply only `scripts/080_converted_content_recovery.sql` as its transaction after installed 079, then re-read the two changed definitions, unchanged recorder/guard/placement trigger, ACL denials and original counts/digests. No conversion or data rewrite is expected. Verify pending audit tables and six storage tables remain empty in the currently unconverted hosted system.
4. Serialize parent merge/deployment and confirm existing route/startup gates. Code/schema order is compatible while disabled. Roll back exposure/code if needed; leave unused denied definitions in place, never erase history/ledger or reset source/authority. Keep all required next slices above open.

Parent review caught a regression where UTC current-row projection rejected non-UTC recorded timestamps. A real converted command recorded in Pacific/Auckland failed before the fix. Cross-timezone command → preview → apply tests now cover both native dated items and converted roots in both directions, while asserting the original event remains byte-for-byte unchanged.
