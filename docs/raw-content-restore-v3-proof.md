# Same-ID raw restore v3 local proof, 2026-11-10

Staged 097 only. Parent owns independent review, hosted backup/application, merge and enablement. All production first-party/REST/MCP native routes remain private/no-store 503. Related #365/#363/#379 remain open.

Source base: exact origin/main `2c81f8ac45f1fad86f8a45015287a38c4175685c`. Implementation plan: `/Users/cal/dev/plans/365-raw-restore-v3-reorder.md`. No children, hosted access, activation, merge, watch, full e2e or publication was performed.

## Archive and frozen contracts

The authorized private pre-096 archive `/Users/cal/.local/share/holofolder/backups/2026-11-10T08-01-40Z-before-096` includes 095. Its SHA256SUMS all verify; directory mode 0700 and archive mode 0600 remain. A new owned PostgreSQL 18.4 cluster listens only on Unix socket `/Users/cal/.local/share/holofolder/raw-restore-097-local/s`, port 55597, SQL owner `restore097`, without a TCP listener. Restore uses real role names and archive ACLs, `--no-owner`, then 096 inactive and 097 twice. `preserve097baseline` retains 096 only; `preserve097` adds 097. All original 90 table counts and 35 digests match. Table/column ACLs, RLS flags/policies, function ownership/configuration/ACLs and every prior compiled definition except the intended gateway are identical to the independently retained local baseline. V1/v2 helpers are unchanged. Local ownership comparison does not claim hosted role-owner equivalence.

Every numbered file 073–096 stays byte-identical. New helper is revoked from PUBLIC, anon, authenticated, holo_mcp and service_role. The gateway retains its original grants. No timeout, generic recorder/inverse definition, native admission or 096 enforcement state changed.

## Actual committed reorder and inverse

Seven opt-in SQL tests pass. Only disposable synthetic fresh-schema databases receive committed active fixtures. The genuine 083 fixture creates a copied 1,025 National Dex, edits targets, populates disjoint physical copy sets through supported commands, saves real wanted roles, and exports through the actual complete-reader/serializer. It performs a supported slot move and real COMMIT, plans against the new complete order, restores and COMMITs, then previews/applies the maintained native inverse and COMMITs. Restored content, wants, manifest/origins and physical fields match by identity; inverse restores the reordered pre-restore state while advancing layout/slot revisions. Exact accepted replay still returns its original proof after inverse.

The final genuine run measured restore 1,685 ms, deferred 39 ms, COMMIT 1 ms, native preview 667 ms and inverse including COMMIT 2,110 ms. Its 3,077-entity audit matched the entire prospective private graph. These are local synthetic measurements, not hosted load or RPC deadline guarantees.

## Simultaneous bounded envelope

All cases below use 1,025 slots, 2,050 refs, 3,077 audit entities and already committed populated history. Every forward restore and native inverse commits. SQL retains 10s statement and 3s lock budgets. JSONB byte estimates match the actual recorded graph. V3 order fields count toward command bytes.

| Case | Prior events | Wants | Command JSONB bytes | Audit JSONB bytes | Restore ms | Preview ms | Inverse and COMMIT ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| work 8,192 | 553 | 4092 | 1664478 | 2543800 | 1972 | 792 | 2427 |
| command1.75MiB-graph2.5MiB | 559 | 4092 | 1835008 | 2621440 | 1797 | 732 | 2191 |
| before-wants2.5MiB | 563 | 4092 | 1666538 | 2621440 | 1813 | 764 | 2276 |
| duplicated-manifest2.5MiB | 568 | 4092 | 1704339 | 2621440 | 1868 | 788 | 2360 |
| sparse-before-wants2.5MiB | 572 | 0 | 868688 | 2621440 | 1514 | 677 | 2112 |

The combined maximum saturates command 1,835,008 bytes, graph 2,621,440 bytes and work 8,192 together, including multibyte text. Command+1, graph+1, work+1 and the former 4 MiB envelope refuse with unchanged data/event/ledger digests. Other cases cover large before-wants, duplicated manifest roots and sparse desired wants. Real identical-delivery/edit/unlink races, failed actual accepted/rejected COMMIT, malformed/forged orders, layout overflow, origin drift, permanent cross-version accepted/rejected ledger collisions and current authorization before replay pass. Pre-097 rejects v3 without mutation or terminal proof. A bounded EXPLAIN ANALYZE uses the real bridge and rolls back. A complete fresh numbered-schema replay passes independently.

During development, fixture failures exposed positional assumptions in copy selection and graph padding after reorder, plus obsolete browser labels. Those fixtures were corrected to select stable IDs. Earlier logs remain; no backend validation or deadline was relaxed.

## Consumer and API verification

72 focused unit/transport/queue/docs tests pass, including real REST/MCP SDK discovery, v1 unversioned/v2 compatibility, strict v3 requests/receipts/rejections, exact revision advances and order proof binding. Existing durable intent tests run in both unchanged and reordered modes: lost reply/reload, proof persistence failure, unknown/future/raw-byte retention, current membership/session/read/lease fences and explicit rejection reconciliation. A fresh same-revision read with wrong order cannot ACK a retained v3 proof; a later correct read settles it without another apply.

The affected production-mode Backup/raw-restore matrix passes 96 cases across 375/390/430 browser and emulated standalone with insets. It covers position review, actual IDB/HTTP and separately fresh complete-read ACK using a synthetic RPC backend. SQL correctness is established separately above. Typecheck, lint with 51 existing warnings, production build/docs CSS and diff checks pass. No full e2e or physical installed-device proof was attempted.

Reproduction on the owned cluster:

```sh
RAW_RESTORE_V3_TEST_SOCKET=/Users/cal/.local/share/holofolder/raw-restore-097-local/s \
  /Users/cal/.local/share/holofolder/toolchains/bun-1.3.14/bun-darwin-aarch64/bun test \
  --timeout 300000 tests/raw-restore-v3-sql.test.ts
```

The suite uses the independently replayed `holofolder_fresh_raw097` synthetic database and rollback-only preserved databases. Run the whole file in order; envelope cases intentionally reuse the genuine committed synthetic fixture. Owned servers are stopped after verification; restart the private cluster deliberately before reproduction. Setup script and raw logs are retained privately under `raw-restore-097-local`, without private row/file bytes in reports.

## Remaining full-restore and rollout gates

Full restore still excludes slot creation/deletion, grid/configuration changes, changed copied manifest/origin mapping, converted/graded collections, full-owner/multi-collection/cross-storage restore, settings/assets/CSV and acquisition/new ownership. Parent retains independent exact-head review, fresh hosted restore-verified backup and prerequisite/application review, unsynced-device protection, old-client version floor, hosted auth/body/performance checks, required CI/reviews, merge, deployment/enablement, publication and full acceptance. Applying 097 alone enables nothing.
