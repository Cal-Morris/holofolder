# Converted recovery: full-workload transaction control

Related #396/#379. Local evidence based on `c9527dc`, including merged #438 / `bdf55fd1b1e4906fed92b155c73cf6aca27a2636` and migrations 073–085. **No SQL change or migration 087 is shipped.** Independent 086 is untouched. Both issues remain open; parent owns acceptance, backup/application, merge and release.

## What the control establishes

The unchanged complete converted cascade regression passes locally, but its original maximum has little headroom and has genuine recorded 10-second failures. The fixture creates, deletes, recovers and flushes its entire history inside one outer transaction, including 512 later events. This repeatedly inserts/deletes the recorder's same `(transaction_id, owner_id)` pending key. A real later recovery intent starts a new transaction.

An independent private restore ran the same preceding cases and the same maximum, then committed its fully populated fixture before recovery. Complete snapshots and full private plans were compared across commit. **No source row, frozen mapping, inventory identity/version, root, binder metadata, ledger row or retained event changed.** All 512 later events remain. The original event ID, restored IDs and exact plan/token remain the same. No ANALYZE, planner forcing, workload truncation, timer increase or history deletion obtained this result.

Rolled-back EXPLAIN of the recorder's existing `INSERT ... ON CONFLICT DO NOTHING`, after inserting the same synthetic pending row, measured:

| Fixture state | Planning ms | Execution ms | Shared hits | Shared reads | Rows inserted / conflicting |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original outer transaction (UTF-8) | 0.004 | 0.044 | 131 | 0 | 0 / 1 |
| Identical committed fixture, new transaction (UTF-8) | 0.005 | 0.022 | 2 | 0 | 0 / 1 |

This is 65.5 times fewer buffer hits per duplicate pending-key check. It measures one repeated recorder operation, not the entire apply. The complete same-state control below establishes the whole-path effect. Recorder 076 is unchanged; changing its key or bypassing capture would solve the wrong problem.

## Complete workload results, unchanged 085 SQL

The original repository SQL tests are unchanged. The measurements below were initially diagnostic SQL_ASCII runs; UTF-8 acceptance results are recorded separately below. SQL_ASCII incorrectly counts bytes for the native suite’s Unicode grading-length boundary and is not accepted as that regression’s proof. This setup defect was caught before final verification; the earlier logs remain intact. The full converted adapters alter local connection/module setup and avoid reinstalling historical functions over the current schema. Native maximum verification selects the existing performance mode, preserving its 512 later events and tightening setup statements to 10 seconds too. Original full runs retain every preceding case, timezone/mapped/permission/allowance/ABA/rollback/replay assertion and adversarial tail.

| Run | Full original transaction apply ms | Same-state committed apply ms |
| --- | ---: | ---: |
| Complete original regression | 8,418 | not measured |
| Complete original regression, phase logging | 9,657 | not measured |
| Independent commit control 1 | not measured | 7,238 |
| Independent commit control 2 | 8,984 | 6,527 |
| Independent commit control 3 | 8,488 | 5,578 / 5,891 / 5,785 / 5,506 |

Original harness wall times include immediate replay/side-effect checks. The first three control-3 repeated timings stop after actual apply plus flush, with replay/assertions timed separately; its final harness result includes them. The four control-3 committed applies each have a new outer transaction. Each successful apply, replay and exact restoration assertion is followed by rollback. Complete original data/history and byte-equivalent private plan are checked before the next transaction. The diagnostic control-3 deadline margin is **4,109 ms**; across those committed diagnostic controls, the worst result leaves **2,762 ms**. UTF-8 acceptance is separate below. These are individual serial local measurements, not percentiles or a production SLA. Other activity on the shared machine is not controlled.

### UTF-8 acceptance

The fresh UTF-8 restore matched all original counts/digests before 085 installation. With unchanged 085 definitions:

| UTF-8 workload / transaction | Preview ms | Apply / flush wall ms |
| --- | ---: | ---: |
| Complete original converted suite, unchanged outer fixture | 1,454 | 8,469 |
| Independent same-state control, before commit | 1,729 | 9,242 |
| Same fixture/history/plan, committed attempt 1 | same plan | 5,843 |
| Same fixture/history/plan, committed attempt 2 | same plan | 5,882 |
| Same fixture/history/plan, committed attempt 3 | same plan | 5,606 |
| Same fixture/history/plan, final committed apply/replay/assertions | same plan | 5,670 |

A second independent UTF-8 control additionally snapshots **raw slot and placement rows, including every version and timestamp**:

| Exact-row control | Apply / flush wall ms |
| --- | ---: |
| Original outer transaction | **10,009, cancelled by the unchanged 10s deadline** |
| Byte-equivalent committed fixture, attempt 1 | 7,260 |
| Attempt 2 | 6,703 |
| Attempt 3 | 6,229 |
| Final committed apply/replay/assertions | 6,428 |

The cancelled original apply rolled back without any row, ledger or history change. Full raw rows and complete SQL-jsonb plan text remained byte-equivalent across the subsequent commit. **All eight committed UTF-8 applies passed**, with at least **2,740 ms observed local headroom** across both controls. The original failure is preserved, not excluded from the report. Each prior attempt rolled back completely; each subsequent attempt started a new transaction and revalidated byte-equivalent complete data/history/plan. The complete original suite passed its full adversarial tail separately. This is the accepted local benchmark evidence; earlier SQL_ASCII diagnostics are not substituted for UTF-8 verification.

The committed controls retain the **full maximum workload**: 4,096 slots, 4,096 physical copies, 1,025 complete frozen source rows/mappings, edited target/wants/order/grade evidence and 512 genuine separately flushed later events. They are supplemental controls stopping after the maximum, **not** a replacement for the complete original suite's adversarial tail. The complete original suite passed separately. Earlier inherited failures before/after 084 and after 085 remain valid original-fixture evidence. An isolated maximum-only 8.8-second result never established a full-regression pass.

A 1 ms forced cancellation still leaves the intent unapplied and retryable. Accepted retries restore exact copies/acquisition/grade/certificate/wants/frozen data, append one linked event, preserve original history and replay the same receipt. The external statement timeout remains **10 seconds** for every invoked preview/apply, including actual writes, constraints and recorder flush.

## Phase costs and rejected changes

The original low-overhead full-transaction probe measured approximately 1,460 ms for discovery/locks, 1,908 ms for reviewed preview, 1,486 ms for the final fresh plan, 4,141 ms for writes and 543 ms for deferred constraints/recorder. Its total apply/flush/replay was 9,657 ms. All three plan reads remain.

A later rolled-back EXPLAIN on the fully committed UTF-8 fixture measured **3,908.315 ms SQL execution**, **3,909 ms complete apply plus separate flush wall time**, 0.01 ms planning, one Result row, 2,668,526 shared hits, 91 shared reads and 53,975 / 58,332 temporary blocks read/written. Its discovery/locks, reviewed preview and final private plan took approximately **528 / 860 / 571 ms**; writes **1,360 ms**, target/catalog validation **81 ms**, final counters/context **14 ms** and deferred constraints/recorder **492 ms**. This is additional warm local phase evidence, not the selected acceptance result or a directly paired percentage comparison. Committing permits ordinary visibility/pruning/statistics behavior as well as a new pending key; no manual ANALYZE or vacuum was used. The single pending-key probe does not attribute every millisecond of the total improvement to that one statement.

A cached retained-copy join also showed 8,386,560 rejected join pairs and 2,239,634 shared-buffer hits. A correlated lookup prototype removed that scan and preserved the complete private maximum plan, but clean full-transaction apply still took 8,772 ms and other probes timed out. Fixed SQL branches for per-row state reads did not materially improve the full result either. Neither prototype is shipped. Full-row extraction was only about 80 ms per 1,025 frozen rows, so no cache was added. Migration 087 remains unused.

Nested auto_explain initially serialized large synthetic parameters and added substantial overhead; its timeout is diagnostic evidence, not an acceptance measurement. Later probes suppressed parameter output or used low-overhead phase logging. All failed runs, EXPLAIN files and prototypes are retained privately.

## Reproduction and preservation

Use a NEW private socket-only PostgreSQL 18 cluster, port 55588, in `issue396-converted4096-gate-local/s`. Explicitly use `initdb --encoding=UTF8`, or create each database with `createdb --template=template0 --encoding=UTF8`; verify `SHOW server_encoding` before restore/testing. The immutable pre-085 archive contains 084; restore it privately with original ACLs/local ownership and service-role RLS bypass, then install exact 085. Archive SHA-256: `84c6acaa82dadf5cd2bb423b1c88923b1c8e9cc76b76fed26d1c1bbc5a39d6bf`. Dumps, auth/source rows, plans, certificates and logs stay outside Git. Other workers' clusters and all archives are untouched.

The private `original-full-utf8.private.ts` is the unchanged full suite with connection/module adaptation. `committed-control-utf8.private.ts` and `committed-exact-utf8.private.ts` run the same prefix and real maximum in independent UTF-8 restored databases; the latter also compares raw slot/placement versions and timestamps. At the maximum:

1. Preserve full state/frozen provenance, roots, binders, ledger and complete owner history; compute the complete private plan as SQL-jsonb text.
2. Measure an original apply under a savepoint and the unchanged 10-second deadline; roll it back and assert every preserved value unchanged.
3. Commit the exact fixture, begin a new transaction, keep the 10-second deadline and assert byte-equivalent state/history/plan before applying.
4. Measure complete apply/flush, verify replay and exact restoration, roll back the apply, assert the original snapshot, then commit/begin again for each repeat.
5. Run the complete original regression separately; never substitute these controls for its adversarial tail. Keep the original failures and report both methods.

All local artifacts are under `/Users/cal/.local/share/holofolder/issue396-converted4096-gate-local`. Commit controls use only worker-owned independent restores and synthetic fixture writes. Fresh-schema/race databases are disposable; stopped committed-control copies and logs are retained privately for parent inspection. Source-backed rollback regressions must recheck all **90 original table counts, 35 critical digests**, archive SHA, original function bodies/owners/ACLs, policies/RLS, recorder/guards and runtime denials. Temporary probe definitions are restored to exact original 085 definitions before final verification.

Final UTF-8 verification passed:

- The complete original converted cascade regression, unchanged 10s cancellation/retry, exact-row committed controls, current native recovery, 1,025/4,096 native deletion, nondefault creation and explicit-default v2 maximum/regressions all pass. This covers timezone, permission/allowance, ABA, rollback, replay, identity and frozen-source checks.
- Full numbered fresh-schema replay passes in UTF-8. Actual two-session native/default races pass, including membership/dependency/default waits, replacement ABA, unlink-first and one accepted replay receipt.
- The historical 080 suite passes with its normal 077/079/080 preparation, followed by exact 081–085 restoration. Forcing its old pre-081 unsupported mapped/deletion assertions onto 085 first produced a recorded expected-version mismatch; those assertions were not weakened or edited. Current mapped/deletion behavior is covered by the complete 081 cascade regression.
- All 90 original counts and 35 digests match after rollback in both the original diagnostic restore and final UTF-8 restore. Current pre-085 and original pre-081 archive hashes are unchanged. Every original function body/owner/ACL, table ACL/RLS/policy and private/staged runtime denial matches the initial 085 snapshot. No probe definition remains in these reference databases.
- 1,450 unit-suite entries, typecheck and lint pass. Lint retains 55 existing warnings, none added. Existing lockfile dependencies were installed to repair the stale checkout; no dependency/lockfile change is included. Production build and full e2e were not run for this documentation-only PR; CI/parent release gates remain separate.

Only this worker's cluster is stopped after verification; all archives and other workers' clusters remain untouched.

## API and rollout limits

This corrects local benchmark interpretation; it does not create a new capability or establish hosted PostgREST cancellation, production load/memory, arbitrary metadata/history or universal latency. No public API/REST/MCP/OpenAPI registry, grant, conversion, route, Undo/Activity/offline or browser capability changes. Existing unconditional route gates remain. No migration application, hosted access, merge, watch, full e2e or publication was performed.

The [internal API inventory](public-api/coverage.md) and [unpublished release draft](releases/native-creation-recovery-draft.md) remain explicit about these limits. Parent must review this proof before accepting the benchmark correction, keep #396/#379 open for their full scope, and own any future backup/application/release. No new migration or marketing announcement is warranted by this evidence-only change.
