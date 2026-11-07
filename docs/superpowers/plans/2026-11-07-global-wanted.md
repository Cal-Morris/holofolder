# Global Wanted Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every wanted printing across all binders, with per-person assignment.

**Architecture:** Extend existing wanted JSON with optional stable user IDs, preserving old data as Unassigned. Group the existing all-binder lookup without changing per-binder storage. Reuse the wanted list and actions sheet, keeping cross-binder edits explicit.

**Tech Stack:** TypeScript, existing Supabase collection JSON, React, Bun and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-collection-value-wanted-and-partner-push-design.md`

## Global Constraints

- Per-card You, Partner or Both; legacy wants are Unassigned.
- Global results retain every binder location; no automatic removal across binders.
- Attribution survives normalization, conflicts, offline sync and backups.
- Only current partnership members may be newly assigned; unchanged former assignments survive without disclosing private profile data.
- No new table/column is needed for optional JSON attribution.

## Review Focus

- Legacy queued writes must not erase newer attribution.
- Concurrent assignments preserve each user's independent changes.
- Missing cached binders must be visibly incomplete, never silently empty.
- Global actions target a chosen binder, never whichever happens to be open.
- A new partner does not inherit a previous partner's wants.

### Task 1: Attribution and grouping

**Files:** `lib/domain/cards.ts`, `lib/collection/normalize.ts`, `lib/collection/sync.ts`, `lib/wanted-dashboard.ts`, `lib/binders/all-binders.ts`, new `lib/wanted-people.ts`, `tests/wanted-people.test.ts`.

**Interfaces:** `WantedCard.wanted_by?: string[]` distinguishes legacy absence from explicit unassignment; normalizer accepts at most two UUIDs. `groupGlobalWanted(entries)` produces one entry per printing/language/finish with `locations` retaining individual cards and binder/species references. `mergeWantedPeople(base, local, server)` implements membership additions/removals, treating omitted local attribution as unchanged.

- [ ] Write synthetic normalization, same-printing/different-binder grouping, former-partner label and merge tests.
- [ ] Run `bun test tests/wanted-people.test.ts`, expect RED.
- [ ] Implement pure helpers and extend collection fingerprints/three-way merges.
- [ ] Run affected unit tests, expect GREEN.

### Task 2: Authorized writes and local persistence

**Files:** `app/api/collection/route.ts`, `hooks/use-collection.ts`, `tests/wanted-people.test.ts`, collection sync/API tests.

- [ ] Test explicit foreign assignment rejection and legacy attribution preservation.
- [ ] Resolve allowed members server-side; validate incoming attribution, preserve omitted values from the existing row and retain unchanged historical assignees.
- [ ] Newly added wants default to the signed-in user; imported/old wants remain Unassigned. Normalize/serialize through existing snapshots, queued rows and backups.
- [ ] Run unit suite and typecheck, expect pass.

### Task 3: Global navigation, labels and actions

**Files:** `components/wanted-dashboard.tsx`, `components/wanted-row-actions-sheet.tsx`, `components/binder/main-content.tsx`, `components/binder-app.tsx`, `hooks/use-all-binders.ts`, `lib/binders/all-binders.ts`, `e2e/binders-all.e2e.ts`, new `e2e/wanted-people.e2e.ts`.

- [ ] Add phone tests for global default, person labels, assignment, grouping and explicit binder selection; observe RED.
- [ ] Wanted defaults to Global Wanted with a This binder toggle. Group duplicates, show union of assignees and binder names. The existing partner hook supplies only current authorized labels.
- [ ] Extend the existing actions sheet with person assignment and binder locations. Current-binder Got remains explicit; other locations navigate to that binder's Wanted view before editing. Preserve overlay history, close controls and dock behavior.
- [ ] Track all-binder lookup coverage; label loading/partial offline results, including genuinely empty binders returned by a complete read.
- [ ] Verify at all six phone modes, offline and read-only behavior.

### Task 4: Release

- [ ] Run full unit, typecheck, lint, build and all-six-project e2e checks on the final head.
- [ ] Fresh branch review, fix substantive findings with regression tests.
- [ ] Commit/push once, open/link PR, merge after checks and verify production under the release skill.

## Execution evidence

- Baseline: 895 unit tests passed.
- Attribution/grouping tests observed RED for missing helper, then GREEN; total unit suite now 900 passed.
- Focused original Wanted and acquisition suite: 17 passed at browser 390.
- Global Wanted, cross-binder hints, assignment/offline queue, explicit destination navigation and incomplete cache: 36 passed across all six phone projects.
- Reviewer found an overlay-history navigation race and unknown-binder cache poisoning. Both were reproduced RED in browser tests and fixed GREEN. Smallest standalone viewport additionally caught an undefined safe-area variable; the panel now uses env(safe-area-inset-top) and keeps its close header visible.
- Typecheck and lint pass with the existing 65 warnings; no new warnings.
- Full suite/release remain gated by baseline UI test navigation repairs being completed in the valuation branch. No migrations required for optional JSON attribution.
