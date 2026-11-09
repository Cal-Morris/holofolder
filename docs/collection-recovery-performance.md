# Private native collection recovery performance (079)

This is local SQL evidence for part of #396/#383, dependent on #414 at `f6c3e3fa4e81f86fc09ea907d36faf7093c79be5` (main base `a4c9c354d1d89114849ede320e396a32bc9d0509`). Neither issue is complete. No hosted read/write, migration application, runtime grant, API/UI enablement, merge or Framer update was performed.

## Workload and method

A new Unix-socket-only PostgreSQL 18 restore, port 55596, was created from the private pre-078 archive whose SHA-256 is `df15f8ae40e9de1e863c25a0b2fba1889cda10a9c680b05678282a894ec14eb0`. The archive and all private verification/log files remain outside Git. Restoration matched all 90 table counts and 35 critical digests. Original archive roles/ACLs were restored locally, including the service role's RLS-bypass attribute, without granting it any staged executor. Existing worker clusters were untouched.

The baseline is published #414, including genuine 076 capture and 077 recovery. Both variants use the existing deletion test's synthetic fixtures: 1,025 mixed slots with 257 owned copies (partner caller), and a default collection with 4,096 slots and 4,096 owned copies (owner caller). Deletion retains all copies as Unassigned. The events contain respectively 1,285 / 8,197 entities and 514,813 / 3,066,320 SQL-jsonb evidence bytes. Maximum deletion receipt JSON contains 9,229,072 bytes as measured by the existing test's JSON serialization. Exact IDs, target/want/order data, private certificate values, acquisition dates and duplicate copies are asserted, not printed.

Each mutation/EXPLAIN fixture rolls back. Bounds: 300-second baseline statement timeout, 4 MiB work_mem; candidate acceptance uses a 10-second invoking-statement deadline. Later-history cases retain 512 real separately flushed updates to an unrelated native slot after the deletion. These exercise complete later-entity scanning and coexistence, not a mocked history counter. Committed concurrent replay/membership tests clean up only their synthetic accounts through the privacy cascade.

Temporary phase instrumentation, nested auto_explain and process RSS sampling were private probes, not shipped code. No ANALYZE, planner forcing, new index, timeout increase or history truncation was used to obtain the improvement. Measurements are individual local warm-cache runs, not percentiles. Earlier baseline unit/build checks overlapped part of the long baseline run; isolated probes and same-state plan comparisons independently confirm the attributed costs. Service/network/production performance is unmeasured.

## Confirmed causes and changes

1. Growing JSONB concatenation: the 4,096-slot planner spent **16,252.963 ms** building its inverse. Changing only that builder to expanded-array append plus one final conversion reduced that phase to **24.871 ms**; the remaining conflict loop still took **32,987.611 ms**, and preview still took **33,335.540 ms**. The selected rows and their order are unchanged.
2. Per-slot expansion of the complete inverse for retained layout evidence: baseline conflict checking took **31,883.318 ms**. Computing the same collection-ID set once after Unassigned filtering removes those repeated expansions/spills. Wrong-collection/missing evidence remains unsupported. Existing layout, placement, grade, ABA, catalog, default, allowance and dependency/fingerprint checks remain.
3. The actual populated-history/adversarial regression exposed a separate deferred consistency hot path. The two-change candidate timed out at 10 seconds inside `check_slot_placement_v1`; a private diagnostic run completed recovery in **13,696.175 ms**. Nested EXPLAIN showed one slot check hashing **all 4,096 placements**, 8,259 shared-buffer hits and 8,192 heap fetches, despite an existing unique slot index. The outer query already requires `s.id=slot_key`; replacing the inner correlation `p.slot_id=s.id` with `p.slot_id=slot_key` makes it a single-key lookup and preserves exactly the status/placement bijection. No constraint/trigger is disabled or dropped.

All three apply plan reads remain. The locked fresh fingerprint, owner/partner membership lock before 4701/root even for owner callers, current billing/permissions, absent identity protections and same-operation replay ordering remain in the unchanged executor. The existing 076 recorder, capture, immutable guard, redactor and account-lifetime retention are unchanged. Original history stays immutable; recovery appends a new linked event.

## Timing, plans and memory

The initial baseline/two-change probe below isolates planner work before the third trigger change. EXPLAIN execution includes apply's constraints/flush; wall time includes its separate final flush too. Every top-level plan is a one-row Result wrapping the private function, with no parallelism. Nested trigger evidence above provides the indexed lookup attribution; top-level EXPLAIN does not expose all nested scan rows or count history entities.

| Workload | Baseline preview wall ms | Two-change preview wall ms | Baseline apply/flush wall ms | Two-change apply/flush wall ms |
| --- | ---: | ---: | ---: | ---: |
| 1,025 mixed | 623.317 | 97.878 | 1,981.910 | 403.285 |
| 4,096 owned | 48,473.972 | 1,076.566 | 156,457.817 | 7,332.706 |

| 4,096 EXPLAIN metric | Baseline preview | Two-change preview | Baseline apply | Two-change apply |
| --- | ---: | ---: | ---: | ---: |
| Planning ms | 0.011 | 0.007 | 0.010 | 0.007 |
| Execution ms | 47,803.144 | 724.031 | 156,457.138 | 7,332.358 |
| Shared hits | 89,590 | 331,150 | 102,101,812 | 3,544,481 |
| Shared reads | 0 | 0 | 0 | 0 |
| Temp blocks read | 1,738,651 | 2,371 | 5,222,347 | 13,931 |
| Temp blocks written | 1,738,824 | 2,544 | 5,222,885 | 14,469 |
| Returned rows | 1 | 1 | 1 | 1 |

These are aggregate nested-function buffers, not just the Result node's own cost. Shared hits can increase for a faster preview, so hit count alone is not the performance conclusion. The preview removes over 99.8% of temporary I/O. Baseline apply spent 50,525.945 / 46,370.634 / 47,530.512 ms in its three plan/review phases; the two-change candidate spent about 0.45 / 0.71 / 0.45 seconds. There is no need to weaken/reuse those reads.

Sampled backend process RSS peaks for the initial same-workload runs were **478,400 KiB baseline / 558,624 KiB two-change candidate**. This includes backend/shared mappings and retained allocations, and is not query-allocation accounting or a portable memory ceiling. The 97.878 ms small preview finished before the first 100 ms sample, so its RSS sample is unavailable. No memory reduction is claimed. Evidence payload limits remain separate from process memory; production memory/load validation remains pending.

Final **079** regression on the same-state comparison fixture, with 512 later events:

| Slots / owned copies | Original 077 raw-plan ms | 079 raw-plan ms | Exact private plan equal? | 079 preview ms | 079 apply + constraints + audit flush ms |
| --- | ---: | ---: | --- | ---: | ---: |
| 1,025 / 257 | 588.357 | 48.724 | yes | 92.550 | 385.189 |
| 4,096 / 4,096 | 46,155.320 | 760.144 | yes | 777.059 | 5,807.826 |

Both invoked preview/apply statements passed the **10-second** external statement deadline. A 1 ms deadline failure left the same intent's state and ledger unapplied, then the same operation ID succeeded. This fixture includes rejected/stale commands and recorder-failure rollback before recovery, which exposed the cached hashed-placement plan and is stronger than a fresh-connection timing alone. The complete private plan equality includes inverse order, all conflicts/unsupported reasons, dependencies, root and collection IDs, hence identical fingerprint input. Later events are retained in full.

Final 079, no later history, same synthetic workloads (single-run wall times):

| Slots / phase | Published #414 ms | 079 ms | Delta ms | Change |
| --- | ---: | ---: | ---: | ---: |
| 1,025 preview | 623.317 | 94.203 | -529.114 | -84.89% |
| 1,025 apply | 1,981.910 | 365.929 | -1,615.981 | -81.54% |
| 4,096 preview | 48,473.972 | 931.779 | -47,542.193 | -98.08% |
| 4,096 apply | 156,457.817 | 4,550.998 | -151,906.819 | -97.09% |

For 4,096 slots, final 079 EXPLAIN preview/apply execution was **495.621 / 4,550.642 ms**, planning **0.009 / 0.010 ms**, shared hits **60,536 / 20,064,444**, shared reads **0 / 0**, and temporary read/write blocks **2,371 / 2,544** and **13,931 / 14,469**. Each returned one row. Compared with baseline preview/apply, execution fell **98.96% / 97.09%**, shared hits changed **-32.43% / -80.35%**, and temporary reads fell **99.86% / 99.73%**. The top-level plan shape remains a one-row Result, with no parallelism or top-level sort. Nested function scans still spill bounded JSONB material; 079 removes repeated full-document work rather than promising zero temporary I/O.

Final sampled backend peak RSS was **566,400 KiB**, versus the baseline **478,400 KiB**. Memory did not improve. Final apply phase timings were approximately **0.24 / 0.50 / 0.23 seconds** for initial plan, locked preview, locked plan, **1.47 seconds** for writes, **1.73 seconds** for catalog/target/allowance validation, and **0.39 seconds** for deferred constraints plus the original recorder. The unchanged validation phase varies with cached query plans; do not infer a universal production latency from this local sample.


Final separately instrumented 512-later-event run (same bounded fixture):

| Slots | Phase | Wall ms |
| --- | --- | ---: |
| 1,025 | preview | 94.603 |
| 1,025 | apply | 416.027 |
| 4,096 | preview | 956.666 |
| 4,096 | apply | 5,950.084 |

The maximum case's complete later-history phase took about **2 ms per plan**, with no sampling/truncation. Its EXPLAIN apply execution was **5,949.793 ms**, temp read/write blocks **13,931 / 14,469**, shared hits **21,734,644**, shared reads **0**, planning **0.008 ms**, one returned row. Sampled backend RSS peaked at **532,480 KiB**. This limited history size is not an account-lifetime tail-latency proof.

## Reproduction and verification

On a newly restored private cluster at `/Users/cal/.local/share/holofolder/issue396-perf-local/socket`, user `recovery_perf_test`, port 55596, restore ACLs and the local service-role RLS-bypass attribute as well as data. Never point these suites at hosted state. Install 078 twice before recovery tests; 079 refuses to run without 078. Run sequentially because fixtures touch local billing configuration:

```sh
COLLECTION_AUDIT_TEST_SOCKET=/Users/cal/.local/share/holofolder/issue396-perf-local/socket bun test tests/collection-audit-sql.test.ts
COLLECTION_RECOVERY_TEST_SOCKET=/Users/cal/.local/share/holofolder/issue396-perf-local/socket bun test tests/collection-recovery-sql.test.ts
COLLECTION_DELETE_TEST_SOCKET=/Users/cal/.local/share/holofolder/issue396-perf-local/socket COLLECTION_RECOVERY_COMPARE=1 bun test tests/inventory-collection-deletion-sql.test.ts
```

The recovery suite installs 077 then 079 twice. The deletion suite installs 078 and 079 twice, verifies all private definitions except the intended planner remain unchanged, asserts all private/staged ACL denials for four runtime roles and compares the complete private plan against original 077 on the **same** 512-event fixture. It then enforces the 10-second deadline, forces a 1 ms cancellation and proves no state/ledger change, retries the same unapplied intent successfully, checks exact restoration and one linked event, same-operation replay, and refusal of both status/placement mismatch directions. Existing recovery tests cover stale previews, grades, explicit Unassigned, moved copies, revoked members, allowance failures, recorder failure, assets, sharing privacy and default/layout conflicts. Added cases cover true ABA and unrelated layout roots.

After the final suites and removal of private probe instrumentation, all **90 original table counts / 35 original-column digests matched** the archive; its SHA-256 was unchanged. **100 function/role EXECUTE checks were denied** (all private audit/recovery functions plus fourteen staged prototypes, for each of four runtime roles). Both migrations were installed twice. No temporary instrumentation remains in installed private function definitions.

The complete unit suite passed **1,300 tests**; private audit/recovery/deletion suites passed **six cases**. Typecheck and lint passed with the existing **55-warning** cap, with no new warnings. Production build passed. Full e2e was deliberately not run for this SQL-only hidden change.

Recheck all 90 original table counts and 35 original-column digests after future suites. The audit suite verifies immutability/redaction/privacy and real recorder integration, not a replacement recorder. Run the complete unit suite, typecheck, lint and build. No full e2e applies to this SQL-only hidden change.

## Admission and rollout limits

The practical local target is the existing **10-second** 074/075 intent budget, established **before invocation**, with a whole-intent abort on deadline failure. Finite existing request/result/evidence limits and unsupported legacy, auxiliary, private-asset, conversion and oversized evidence gates remain. This does not cap account-lifetime history by deleting or sampling it; sufficiently large/conflicting history can still fail the whole statement. 512 later events are representative coverage, not proof for every account lifetime. SQL bounds are not a production SLA. A future trusted adapter must bind actor/owner/source from actual auth, establish/cancel the RPC deadline and retain all existing permission/allowance checks before exposure.

Parent owns the fresh hosted backup, 078 then 079 hosted application/readback, review, CI blocker, retarget after #414 merges, and serialized merge/deployment. This slice adds only internal API-boundary documentation, no public operation/OpenAPI generation, Activity/Undo UI, offline replay, conversion or marketing publication. Preserve the open #396/#383 checklists and their remaining gates.
