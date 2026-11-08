# Collection import implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline.

**Goal:** Implement issue #305 without changing the one-owned-printing-per-Pokémon binder.
**Architecture:** A pure file parser, row normalizer and merge planner feed an inline workflow in the existing lazy Settings view. Holo Folder CSV/JSON resolves on-device; external CSV uses explicit mappings and bounded catalogue-only requests. Import writes use the current optimistic queue/CAS path, suppress acquisition notifications and preserve concurrent remote selections.
**Tech Stack:** TypeScript, React, Next.js, Supabase, Bun. No new dependencies or schema.
**Spec:** https://github.com/Cal-Morris/binderdex/issues/305

## Global constraints

- Separate worktree/branch/PR off `ecc2786`, after #304 production verification. No e2e tests.
- 10 MiB/file, 5,000 data records, bounded columns/cell lengths. No bulk direct collection writes.
- Import into active binder only. Preserve occupied owned selections, pending edits and existing wants.
- CSV column mapping covers exporters generically; no unverified vendor-specific claims.
- Grades, condition, quantity other than one, sealed/non-Pokémon products and ambiguous matches are reported as unsupported. Never convert owned cards into wanted cards.
- No imported market prices, ownership IDs, settings or artwork restoration. JSON is collection-only.

## Review focus

- Quoted/newline CSV, malformed JSON and invalid language/finish/status cannot silently change a printing.
- Conflicting owned candidates require a choice; duplicates and repeated imports are no-ops.
- Remote conflicts cannot replace a newly selected owned printing or resurrect a remotely deleted slot.
- Cancellation, binder/account changes, allowance exhaustion and partial failures retain committed/queued work and report it accurately.
- Original CSV data stays local; catalogue requests contain only bounded identity fields. Reports neutralize spreadsheet formulas.

## Task 1: Pure parsing and planning

**Files:** `lib/collection-import.ts`, `tests/collection-import.test.ts`.
**Interfaces:** `parseImportFile(text)`, `mapImportRows(document,mapping,defaults)`, `buildImportPlan(rows,collection,selected?,blocked?)`, `buildImportReport(rows)`. Rows retain source record numbers, optional normalized collection entries and explicit problems.

- [x] Write failing tests for CSV escaping/limits, Holo Folder round trips, backup flattening, invalid values and unsupported metadata.
- [x] Implement the parser/normalizer and strict source validation. Use existing domain types, normalizers, catalogue names and CSV escaping.
- [x] Write failing tests for conflicts, owned/wanted merge, duplicates, explicit choices, projected usage, blocked pending slots and idempotence; implement the merge planner.

## Task 2: Exact catalogue resolution and conflict-safe writes

**Files:** `lib/tcg-mirror.ts`, `lib/collection-import-resolve.ts`, `app/api/collection-import/resolve/route.ts`, `lib/collection/sync.ts`, `lib/collection/offline-queue.ts`, `hooks/use-collection.ts`, focused tests/fixtures.
**Interfaces:** A read-only same-origin POST resolves at most 25 identity lookups, returning bounded normalized candidates/problems. `restoreCollectionItem(next,expected,{importOnly:true})` refuses pending slots and passes an additive import conflict policy through persistence/retry.

- [x] Add failing resolver tests for exact set/number/name or explicit catalog/TCGplayer IDs, language/finish, unknown/ambiguous IDs and multi-Pokémon cards. Add payload/origin/batch boundary tests.
- [x] Reuse mirror mapping/caching and actual external-ID fields. Do not infer ID namespaces. Limit concurrency and response sizes; unresolved matches remain explicit.
- [x] Add failing queue/merge tests: import preserves remote owned/status, appends wants without deleting remote wants, does not resurrect removed slots, and survives queue persistence. Manual edits retain existing semantics.
- [x] Implement the minimal import-only flag, expected-base checks and notification suppression through the existing path. Existing pending edits are reported/skipped rather than coalesced with import writes.

## Task 3: Settings workflow and release

**Files:** `components/collection-import.tsx`, `components/settings-modal.tsx`, `components/binder-app.tsx`, `docs/collection-import.md`.

- [x] Add file selection, source column mapping/sample cells and visible defaults. Render preview/selection, choice/conflict reasons, current-binder scope and allowance usage. Nothing writes before explicit application.
- [x] Apply one operation per Pokémon, checking scope/cancellation before each; report saved/queued/skipped/failed separately. Download a CSV report including original cells. Rebuild preview against live collection and retain results after application.
- [x] Bundle the workflow into existing lazy Settings, using its current overlay/dismissal/scroll behaviour. Cancel resolution/application when closed, replaced or unmounted. Offline Holo Folder parsing/application remains usable.
- [ ] Run focused checks, unit suite, typecheck, lint and build. Manually inspect mapping/preview/results at phone widths/insets without e2e tests. Fresh branch review, fix material findings, commit/push once, create/link PR, satisfy current-head checks, merge and verify production before #306.

Rollback: revert this PR. No schema or stored-card deletion is required; existing queued import flags are additive and old clients can ignore them, so clear/review outstanding import work before rolling back an installed client.

Validation before PR: 1,052 unit tests pass; typecheck passes; lint has zero errors and the existing 59 warnings; production build passes. Exact-ID and name/set/number reads resolve the same real hosted catalogue card. Isolated real-component mapping and preview screenshots at 375/390/430, browser light and simulated standalone dark with 59/34 px insets, show zero horizontal overflow and 36–40 px buttons. No e2e tests. Fresh review found a reverse-only finish exclusion issue, fixed with regression coverage. Release remains pending CI and production verification.
