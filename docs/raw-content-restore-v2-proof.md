# Raw-content restore v2 local proof, 2026-11-10

**Staged draft, acceptance blocked. Do not apply 095 or admit native operations from this report.** The combined 4 MiB / 1,025-slot / 2,050-ref inverse misses the existing 10-second SQL budget. No limits, timeouts, protected recovery definitions or runtime admission were changed to conceal that failure. #365 and #379 remain open.

Source base: #493, `190d60f9fb722d4f546ac129d983d3b1a747fa94`. Contract: [raw-content-restore.md](raw-content-restore.md). The final source head is the associated draft PR head. All numbered SQL through 094 is byte-identical to that base.

- 095 SQL SHA256: `0ad5f0fd86c10b0eb9a2f1f70e3b3fa38d6ae8d485fca3ffd0623126bd0418a9`.
- Unchanged 094 SHA256: `6d536de652ee3e129a8f39b91750d5a0391f835cc3ba3a30f0fac5d830f0de2a`.
- PostgreSQL 18.4, local Unix socket only, no TCP listener: `/Users/cal/.local/share/holofolder/raw-restore-095-local/s`, port 55595, local SQL-owner role `restore095`.
- Bun 1.3.14. The machine's default Bun was older; final checks use `/Users/cal/.local/share/holofolder/toolchains/bun-1.3.14/bun-darwin-aarch64/bun` explicitly.

## Retained archive and preservation

Original archive remains at `/Users/cal/.local/share/holofolder/backups/2026-11-10T03-19-03Z-before-093/hosted-db.dump`, SHA256 `47e258e893e031cedb1584d160b31634aaef5ef74d5d380599cf7338bfa333ca`. Its 90 original table counts and 35 original critical digests matched after restore and local prerequisites. This archive predates 093 and **does not contain 094**. Required 093 and 094 were installed locally only.

`preserve095baseline` is an independently retained restored 094 baseline; `preserve095` adds 095. Archive restoration uses local SQL ownership (`--no-owner`), restores original table/column ACL entries and real role names, and gives `service_role` its required BYPASSRLS attribute. Preservation assertions compare compiled function owners/ACL/configuration and definitions against that local baseline, not hosted ownership. They also compare table/column ACLs, RLS flags, policies and every original count/digest. Only the intended gateway definition and one new revoked helper differ. Repeated 095 application is identical. Runtime roles cannot execute the new helper. Retained-data fixtures always roll back.

Committed commands, races and failed-COMMIT fixtures use only `holofolder_fresh_raw095`, composed from the full numbered schema with explicitly synthetic auth/storage scaffolding. An independent fresh numbered replay also passed in `holofolder_fresh_schema095`. These are not complete Supabase installations or hosted auth proof.

## Actual creation, export and SQL outcomes

The genuine fixture creates a 1,025-target copied National Dex through 083, edits four copied targets to null through supported slot commands, adds and assigns raw copies through supported inventory commands, sets owner/partner wants, and exports through the actual complete-snapshot validator and v2 serializer. SQL-backed private reads use authentic authenticated RLS and 500-row pages. The browser suites separately exercise the actual first-party HTTP complete reader and Backup artifact flow.

The file contains duplicate synthetic Trainer and Energy printings as distinct retained physical IDs. Current assignments are then replaced by a disjoint set of 1,025 copies. V2 restores the file's exact IDs, order, targets, status, role-bearing wants, copied manifest and per-slot origins; all physical item DB fields remain identical. All 1,025 displaced copies stay owned in Unassigned with individual command release consent. The actual 076 audit has 3,077 entities and a complete private inverse; native recovery is previewed, applied and committed. Original accepted replay succeeds after recovery. Additional fixtures cover small non-Dex copied manifests, edited targets, null-origin appends, valid-origin swapping rejection, null/Blank compatibility, unversioned v1 SQL/queued-proof replay and cross-version collisions including committed v1 rejections.

Latest genuine-fixture timings, with retained populated command history, in milliseconds:

| Case | Apply including actual audit and inverse validation | Deferred checks | Real COMMIT | Native preview | Inverse including COMMIT |
|---|---:|---:|---:|---:|---:|
| 1,025 slots, 2,050 refs, 1,025 wants | 1614.38 | 40.45 | 0.52 | 675.06 | 2062.55 |
| Work 8,192: 1,025 slots, 2,050 refs, 4,092 wants, 551 prior events | 1768.61 | 34.58 | 1.05 | 693.39 | 2140.42 |
| Exact JSONB 4 MiB, 1,025 slots, 2,050 refs, 1,025 wants, 553 prior events | 7109.76 | 33.50 | 0.63 | 5602.61 | **57014 timeout** |

The work-edge request is 1,518,071 compact wire bytes / 1,621,523 JSONB-text bytes; its private audit is 2,543,800 JSONB-text bytes. The byte-edge command is exactly 4,194,304 JSONB-text bytes with multibyte text and a 5,116,580-byte audit. Its forward restore commits and preview succeeds, but recovery apply times out after approximately 10,103 ms including subsequent rollback verification. The failed inverse creates zero events and leaves the committed forward placements intact. The opt-in combined-envelope test deliberately remains failing.

The observed interruption is in the unchanged private `recovery_plan_v1` placement-occupancy check:

```sql
NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(inverse) e
  WHERE e->>'table'='inventory_placements'
    AND e->'after'->>'slot_id'=b->>'slot_id'
)
```

Recovery apply recomputes the plan through the maintained preview/plan path. Repeated scans over the large private inverse are the observed interruption site; this report does not claim a completed general performance diagnosis. Optimizing protected compiled recovery definitions is outside this slice's allowed changes. Parent must explicitly resolve that boundary or agree a measured narrower envelope before application/admission. The 4 MiB default is not proved safe by the successful forward receipt.

Other passing SQL fixtures cover real concurrent identical delivery, edit/unlink races, current authorization before historical replay, cancellation/audit/allowance rollback, actual failed accepted and rejected COMMIT, stale/ABA dependencies, denied runtime roles, exact work/per-slot/manifest/item/byte bounds, and a 17-MB prospective old-wants graph rejected without mutation/history/ledger changes. A separate small 4-MiB rollback fixture passes; it does not substitute for the failing combined envelope.

## Reproduction and verification

Set up only the owned socket cluster and independently verified archive restoration described above. Never use arbitrary `DATABASE_URL`, a retained source DB for committed seeds, or a hosted database. The local restoration script and logs are preserved in `/Users/cal/.local/share/holofolder/raw-restore-095-local/`.

```sh
RAW_RESTORE_V2_TEST_SOCKET=/Users/cal/.local/share/holofolder/raw-restore-095-local/s \
  /Users/cal/.local/share/holofolder/toolchains/bun-1.3.14/bun-darwin-aarch64/bun test \
  --timeout 300000 tests/raw-restore-v2-sql.test.ts
```

The test-runner budget covers hundreds of bounded synthetic population commands. Every profiled apply/recovery SQL statement retains the 10-second statement budget and existing 3-second lock budget. Thirteen fixtures pass; the combined byte-edge inverse gate fails as recorded above. Run the complete opt-in file in order because committed race/envelope fixtures intentionally reuse its disposable synthetic database. Source-data preservation tests remain rollback-only.

Focused unit/transport coverage includes the real REST/MCP SDK, exact versioned schemas/discovery/errors, paid 1,025-want planning, persisted v1 commands/proofs, unknown-version record preservation, lost reply/reload, proof-persistence failure, scope/session/read/lease fences and explicit rejection discard. Production-mode phone coverage uses the actual Backup, IDB, internal HTTP handler and fresh-reader composition with a synthetic RPC engine; it is separate from PostgreSQL correctness proof. The lost-reply and proof-persistence injections pause online replay until reload so it cannot accidentally test a second in-flight send instead. Reload tests wait for the failed delivery/proof transaction to release its lease and exercise the existing explicit Retry control when backoff remains active. No production retry/lease timeout was altered.

Final check counts and exact PR head are recorded in the PR description. No full e2e suite, hosted service, physical installed PWA, full owner disaster recovery, converted/graded restore, external assets or provider proof was performed. Parent owns independent review, a fresh hosted restore-verified backup, unsynced-device protection, any newly authorized recovery optimization, full envelope acceptance, migration application, client-version floor, hosted auth/body limits, rollout and publication.

Final local checks: **78 focused unit/transport tests pass**, with 8 opt-in original-094 SQL fixtures skipped on this socket; v1 SQL and persisted-command compatibility are exercised by the 095 fixtures instead. **42/42 raw-restore production-mode checks pass across all six phone profiles.** Backup (48 cases) and native-card consumers (24 cases) also passed in the broader affected matrix. That intermediate aggregate run was 113/114 before the reload fixture's in-flight-send race was isolated; the final raw-restore-only matrix is clean. Typecheck, lint (55 existing warnings), production build plus docs CSS verification, fresh numbered replay and `git diff --check` pass. No full e2e suite was run.
