# Binder Value and Mobile Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current binder's Cardmarket estimate obvious and let users refine it explicitly with sold evidence.

**Architecture:** Add a Cardmarket source option to the existing pure analytics calculation, preserving other consumers' default behavior. Reuse the existing collection comps runner and pinned checks. Show a compact binder summary and a full-width mobile Analytics valuation with refinement results.

**Tech Stack:** Next.js, React, TypeScript, Bun, existing IndexedDB checks and Playwright harness.

**Spec:** `docs/superpowers/specs/2026-11-07-collection-value-wanted-and-partner-push-design.md`

## Global Constraints

- Exact printing/language/finish only; no guessed FX or invented prices.
- Exclude quotes older than 30 days. Unknown prices remain explicitly unpriced.
- No paid calls just from opening either view.
- All six phone projects, safe-area insets, no new lint warnings.
- This PR changes valuation and Analytics only. Follow with independent Global Wanted, push and marketing releases.

## Review Focus

- A preferred non-Cardmarket quote must not leak into the Cardmarket estimate.
- Ambiguous foil and special-edition source evidence must not price a standard finish.
- All-binder copies count separately while comps requests deduplicate printings.
- Cancellation, offline state and scope changes retain completed checks without displaying another scope's total.
- Failed/insufficient sold checks retain labelled Cardmarket fallback rather than implying zero value.

### Task 1: Source-specific valuation and refinement

**Files:** `lib/collection-analytics.ts`, new `lib/binder-valuation.ts`, new `tests/binder-valuation.test.ts`.

**Interfaces:** `buildCollectionAnalytics` accepts optional `source: PriceSource` alongside `countCopies`; `buildRefinedValuation(cards, checks, now?)` accepts analytics cards and a map of pinned sold checks by card/finish key and returns total, sold/fallback/unpriced counts and oldest used check.

- [x] Write synthetic tests asserting Cardmarket beats a preferred TCGplayer amount, wrong finish and invalid/stale/future quotes remain unpriced, copied inventory counts separately, and refinement uses qualifying sold medians with fallback coverage.
- [x] Run `bun test tests/binder-valuation.test.ts`, expect RED before implementation.
- [x] Implement exact-source selection and pure refinement using `buildSoldPriceGuide` eligibility, never asking-price medians.
- [x] Run `bun test tests/binder-valuation.test.ts tests/collection-analytics.test.ts`, expect all pass.

### Task 2: Binder summary and readable Analytics

**Files:** new `components/binder-value.tsx`, new `components/binder-valuation-refinement.tsx`, `components/binder/main-content.tsx`, `components/collection-analytics-view.tsx`, `components/collection-analytics-overview.tsx`, `components/collection-price-check.tsx`, `e2e/analytics-dashboard.e2e.ts`.

**Interfaces:** binder summary consumes collection/prices/loading and `onOpen` callback; refinement consumes analytics summary, online/read-only flags. Extend existing price-check button with optional label, scope label and completion callback, preserving default consumers.

- [x] Extend e2e to assert the binder summary, Cardmarket label, full-width mobile value, no spontaneous comps calls and correct refinement/fallback coverage after explicit checking.
- [x] Run the changed spec, expect RED for absent UI.
- [x] Implement the binder summary as an Analytics navigation button; stack Analytics metrics on phones and lead with value. Keep detailed charts/history secondary.
- [x] Reuse `CollectionPriceCheck` for refinement, loading only pinned checks on mount and reloading them after progress/completion. Cancel on scope change/unmount.
- [ ] Run changed e2e on all six projects with repeat coverage, expect pass.

### Task 3: Verify and release

- [ ] Run unit suite, typecheck, lint, production build and full six-project e2e suite with a dedicated port and two workers.
- [ ] Inspect screenshots and layout geometry at 375, 390 and 430 in both modes and at desktop width.
- [ ] Run fresh branch review, fix substantive findings with regression coverage.
- [ ] Commit, push once, create/link PR, merge after gates and verify production under the release skill. If checks are pending, watch and resume on completion.

## Remaining approved releases

Global Wanted will extend `WantedCard`, normalization, conflict merges, API validation and all-binder grouping/UI together. Partner push will add subscription RLS, atomic acquisition event persistence, durable delivery and existing worker handlers. Marketing will update the existing public page only when each advertised capability ships. Each gets its own implementation plan grounded in its current code before changes begin.

## Execution evidence

- Baseline: 895 unit tests passed.
- New pure valuation tests observed RED for missing implementation, then GREEN. Fresh Cardmarket versus stale supporting-provider regression also observed RED then GREEN.
- Binder navigation regression observed RED with All binders selected, then GREEN after selecting binder scope at the value entry point.
- Focused UI suite: 79 passed, 5 intentionally skipped across all six phone projects; desktop overview included.
- Review: fresh reviewer found source-specific timestamp and remembered-scope bugs; both fixed with regression coverage. Pinned check writes are awaited before refresh.
- Mobile typography: amount changed from 22.5/23.4/25.8px at 375/390/430 to 36px, supporting Analytics text from 12px to 14px; value now spans the phone width.
- Product work remains for Global Wanted, partner push and marketing, tracked in the approved spec.
