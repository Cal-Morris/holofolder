# Raw-content restore v2 local proof, 2026-11-10

**Staged draft, parent acceptance and hosted application remain gated. Do not apply 095 or admit native operations from this report.** The original 4 MiB failure evidence below is retained. The [corrected recovery envelope followup](#corrected-recovery-envelope-followup) narrows v2 to 1.75 MiB commands and complete 2.5 MiB prospective graphs after profiling and exact-limit committed recovery measurements. Protected recovery definitions, timeouts and runtime admission stay unchanged. #365 and #379 remain open.

Source base: #493, `190d60f9fb722d4f546ac129d983d3b1a747fa94`. Contract: [raw-content-restore.md](raw-content-restore.md). The final source head is the associated draft PR head. All numbered SQL through 094 is byte-identical to that base.

- Original 095 SQL SHA256: `0ad5f0fd86c10b0eb9a2f1f70e3b3fa38d6ae8d485fca3ffd0623126bd0418a9`.
- Unchanged 094 SHA256: `6d536de652ee3e129a8f39b91750d5a0391f835cc3ba3a30f0fac5d830f0de2a`.
- PostgreSQL 18.4, local Unix socket only, no TCP listener: `/Users/cal/.local/share/holofolder/raw-restore-095-local/s`, port 55595, local SQL-owner role `restore095`.
- Bun 1.3.14. The machine's default Bun was older; final checks use `/Users/cal/.local/share/holofolder/toolchains/bun-1.3.14/bun-darwin-aarch64/bun` explicitly.

## Retained archive and preservation

Original archive remains at `/Users/cal/.local/share/holofolder/backups/2026-11-10T03-19-03Z-before-093/hosted-db.dump`, SHA256 `47e258e893e031cedb1584d160b31634aaef5ef74d5d380599cf7338bfa333ca`. Its 90 original table counts and 35 original critical digests matched after restore and local prerequisites. This archive predates 093 and **does not contain 094**. Required 093 and 094 were installed locally only.

`preserve095baseline` is an independently retained restored 094 baseline; `preserve095` adds 095. Archive restoration uses local SQL ownership (`--no-owner`), restores original table/column ACL entries and real role names, and gives `service_role` its required BYPASSRLS attribute. Preservation assertions compare compiled function owners/ACL/configuration and definitions against that local baseline, not hosted ownership. They also compare table/column ACLs, RLS flags, policies and every original count/digest. Only the intended gateway definition and one new revoked helper differ. Repeated 095 application is identical. Runtime roles cannot execute the new helper. Retained-data fixtures always roll back.

Committed commands, races and failed-COMMIT fixtures use only `holofolder_fresh_raw095`, composed from the full numbered schema with explicitly synthetic auth/storage scaffolding. An independent fresh numbered replay also passed in `holofolder_fresh_schema095`. These are not complete Supabase installations or hosted auth proof.

## Original creation, export and SQL outcomes

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

Original PR497 local checks: **78 focused unit/transport tests pass**, with 8 opt-in original-094 SQL fixtures skipped on this socket; v1 SQL and persisted-command compatibility are exercised by the 095 fixtures instead. **42/42 raw-restore production-mode checks pass across all six phone profiles.** Backup (48 cases) and native-card consumers (24 cases) also passed in the broader affected matrix. That intermediate aggregate run was 113/114 before the reload fixture's in-flight-send race was isolated; the final raw-restore-only matrix is clean. Typecheck, lint (55 existing warnings), production build plus docs CSS verification, fresh numbered replay and `git diff --check` pass. No full e2e suite was run.


## Corrected recovery envelope followup

Implementation base is exact PR497 head `dd6b5b2ba8d7d5d7e65057056350b822eaff0926`. This is the same draft PR and required unpublished base, not a new feature branch off main. Canonical dirty root and the separate legacy-recipient lane were not edited.

Corrected 095 SHA256: `e9d5190285c2a08b6ba6d13be1099afc9e5866ac6e683393cbd21c5b2f1e13e8`. All 22 numbered files 073–094 remain byte-identical. The original archive SHA256 above was reverified, not replaced. The owned cluster was restarted with no TCP listener after verifying ownership, data directory, SQL owner and absence of other client sessions.

### Measured diagnosis and rejected hypothesis

The original exact-4-MiB failure reproduced before changing bounds: forward 6,872.50 ms, deferred 32.15 ms, COMMIT 0.40 ms, preview 5,718.52 ms, then native inverse `57014` at the unchanged deadline. The baseline test verified the committed forward remained intact and the failed inverse made zero events. Original logs and original report sections are retained.

Temporary phase notices were added only to the local disposable copy of the new 095 helper and removed afterwards. Protected generic functions were never modified. In the original large case, cumulative validation was 360.80 ms, prospective graph 931.68 ms, writes 1,079.02 ms, recorder 1,352.39 ms, then maintained inverse-plan completion 7,451.29 ms. Thus that inverse-plan call added 6,098.90 ms. At work8192 it added 515.15 ms. This identifies the measured cost beyond validation/writes/recording; the original repeated occupancy scan remains protected.

The proposed **2-MiB command / 3-MiB graph hypothesis also failed** at 1,025 slots / 2,050 refs / 4,092 desired wants and exactly 3,145,728 actual audit bytes. Forward committed, inverse timed out in the same protected scan. It is not an approved bound. Its failure is retained in `envelope-max-graphs-proof-2.log` alongside the original `combined-envelope-blocker.log`, `envelope-baseline-followup.log` and `envelope-profile-original.log`.

### Final local bounds and committed measurements

The measured narrower lane keeps S≤1,025, I≤2,050, 100 desired wants per slot and `2S+I+W≤8,192`. It narrows command UTF-8/JSONB text to **1,835,008 bytes (1.75 MiB)** and independently caps the **complete locked prospective graph at 3,077 entities / 2,621,440 bytes (2.5 MiB)** before the first mutation. Both before/after wants and both copied-manifest roots count. Recorder equality and actual maintained inverse validation remain mandatory. Generic historical limits, the 10-second SQL/RPC deadline and 3-second lock wait timeout remain unchanged.

All cases below use the genuine 083-created 1,025-slot collection with disjoint old/new physical copies, populated history, real forward apply, deferred flush and COMMIT, followed by native preview, apply, deferred flush and COMMIT. The prospective-byte test model uses actual private rows; its predicted JSONB bytes equal the real recorded audit. Every row has 3,077 audit entities. Times are milliseconds from the final full SQL run, not hosted latency.

| Case | Prior events | Wants after | Command JSONB bytes | Actual audit bytes | Apply | Deferred | COMMIT | Preview | Inverse + COMMIT |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| work8192 | 552 | 4092 | 1621560 | 2543800 | 2238.12 | 41.14 | 0.53 | 796.10 | 2987.71 |
| command1.75MiB-graph2.5MiB | 558 | 4092 | 1835008 | 2621440 | 2195.32 | 38.85 | 0.34 | 806.15 | 2870.03 |
| before-wants2.5MiB | 562 | 4092 | 1623620 | 2621440 | 2311.33 | 38.88 | 1.07 | 828.49 | 2470.28 |
| duplicated-manifest2.5MiB | 566 | 4092 | 1661422 | 2621440 | 1836.56 | 33.55 | 0.26 | 770.89 | 2297.43 |
| sparse-before-wants2.5MiB | 570 | 0 | 825769 | 2621440 | 1514.17 | 34.20 | 0.51 | 678.10 | 2120.15 |

The maximum-combined case fills command and graph bytes together with all S/I/W/work limits. Other exact graph edges cover large existing wants, duplicated manifest roots and sparse desired wants with concentrated before text. UTF-8 multibyte command padding is checked against PostgreSQL JSONB text. The per-slot100 and work8192 controls remain. In the final genuine creation/export/restore fixture, forward was 2,274.06 ms plus 41.10 ms deferred and 0.35 ms COMMIT; committed inverse was 2,855.60 ms. The complete edge run also passed separately in `envelope-narrower-graphs-proof.log`. These measurements leave RPC deadline headroom; the lock wait budget is unchanged and existing concurrent-delivery/edit/unlink fixtures still pass. They are local synthetic measurements, not a guarantee under arbitrary hosted load.

Each graph edge adds one byte to existing before-wants and verifies SQL refuses with `22023`, unchanged item/slot/placement/root rows, events and ledger counts/digests. The original exact-4-MiB combined command is now explicitly refused by JS and SQL with unchanged state. Command limit+1, 17-MB old-wants and all original malformed/version/work/manifest/ref/allowance/cancellation/failed-COMMIT controls remain. Large populated history uses ordered per-row digests rather than one oversized JSONB aggregate. No failure was waived into an accepted result.

### Planner, transport and retained intent

Local review and trusted planning include both graph states and duplicated roots, reserving maximum persisted position digits because complete reads expose order. Their estimate can conservatively refuse an edge accepted by direct SQL; SQL always computes the exact locked private graph independently. Both use the same UTF-8/JSONB separator accounting tested against actual audit bytes. Oversize is explained before enqueue where computable. Shared REST/MCP schema, request byte ceiling, OpenAPI/discovery/help and unpublished release copy match the narrower command/graph envelope.

Actual streaming HTTP reader tests cover an admitted command at its JSONB boundary, compact wire bytes, wire limit+1 and the escaped planning wrapper's unchanged 12-MiB application ceiling. The unchanged file ceiling remains 10 MiB. Arbitrary private file metadata/escaping can exceed wrapper or deployed platform limits; deployed body/auth limits remain a parent gate, not a production availability claim. All production native routes stay unconditional private/no-store503.

Oversize graph errors map to ordinary `invalid_input`, without a rejection receipt. Generic errors still cannot authorize discard. A canonical queued v2 body valid under the old 4-MiB envelope but unsupported now refuses reads/atomic updates while preserving its raw record byte-for-byte. Persisted v1 bytes, proofs, replay and cross-version fences remain unchanged.

### Verification and remaining gates

- **14/14 opt-in SQL fixtures pass**, including the five committed envelope cases, genuine creation/export, real inverse, races, failed COMMIT, original controls, twice-apply preservation and authentic ACL/RLS/billing checks. Fresh numbered schema replay also passes in `holofolder_fresh_schema095envelope` on the same owned socket.
- **124 focused tests pass**, with eight original-094 socket fixtures skipped on this 095 socket; the 095 suite separately covers unchanged v1 SQL behavior. Queue, proof, UI, transport, version, REST/MCP, OpenAPI and Markdown checks are included.
- **42/42 production-mode restore cases pass** at 375/390/430 browser and emulated standalone with insets. Typecheck, lint with 55 existing warnings, production build/docs CSS and diff checks pass.

Final raw logs live under `/Users/cal/.local/share/holofolder/raw-restore-095-local/`: `envelope-final-sql-proof.log`, `envelope-final-fresh-schema-proof.log`, `envelope-final-focused-proof.log`, `envelope-final-typecheck.log`, `envelope-final-lint.log`, `envelope-final-production-build.log` and `envelope-final-six-phone-proof.log`. No private file bytes were logged; fixtures are synthetic. Earlier archives and failure logs remain intact.

**095 remains unapplied hosted.** PR497 stays draft. Parent owns independent exact-head review, fresh hosted backup/restore verification and prerequisite/application review, unsynced-device protection, hosted auth/body/performance checks, old-client version floor, rollout and full acceptance. No merge, watch, Framer/GitHub project changes, full e2e, hosted or physical-device claim was made.
