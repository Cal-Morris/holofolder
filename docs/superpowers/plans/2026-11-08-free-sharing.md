# Free read-only sharing implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline.

**Goal:** Implement issue #304, allowing free owners to manage enabled read-only binder links.
**Architecture:** Remove only the client/API/renderer entitlement gates and the two restrictive billing share policies. Keep existing owner-only RLS and origin checks, named/token resolution, noindex and public-field filtering. Partner/comparison entitlements and price visibility are unchanged.
**Tech Stack:** Next.js, React, TypeScript, Supabase/PostgreSQL, Bun.
**Spec:** https://github.com/Cal-Morris/binderdex/issues/304

## Global constraints

- One separate worktree/branch/PR, based on main after #308. No e2e tests.
- Preserve share tokens, explicit enable/disable, owner checks, read-only rendering and existing share appearance.
- New additive/idempotent migration, hosted verification/application and data-preserving rollback.
- Leave pricing, import, tracking, price visibility and paid partner/comparison checks unchanged.

## Review focus

- Removing the app gate must not leave free share creation blocked by RLS.
- Disabled or wrong-binder links must stay unavailable on both named/token routes.
- Unauthenticated, cross-origin and other-owner mutations must remain blocked.
- Shared collection bootstrap must strip private metadata and partner identities.
- Rollback must restore paid gates without deleting links or cards.

## Task 1: Behaviour and database checks

**Files:** `tests/free-sharing.test.ts`, `tests/fixtures/free-sharing.tsx`, `scripts/verify-free-sharing.ts`, `scripts/053_free_binder_sharing.sql`.
**Interfaces:** Existing `POST/DELETE /api/binder-share`, named/token page loaders and `SharedBinder` stay unchanged in shape. SQL removes only `billing_share_insert` and `billing_share_update`.

- [ ] Add tests for free creation/rendering, named/token enablement and disablement, ownership/origin/authentication boundaries and public bootstrap. Watch current paid gates fail.
- [ ] Add a rollback-only hosted verifier for owner creation/re-enable/disable, stranger/anonymous denial and unchanged partner paid access. Watch the existing RLS deny the free insert.
- [ ] Remove only the two paid-share policies in migration 053; verify double application and rollback without altering owner policies or existing records.

## Task 2: Remove entitlement gates and release

**Files:** `components/binder-app.tsx`, `components/shared-binder-page.tsx`, `app/api/binder-share/route.ts`, `components/billing-settings.tsx`, `lib/billing.ts`, `docs/billing.md`, `scripts/MIGRATIONS.md`.

- [ ] Remove create/copy/API/render paid checks, preserving authorization and error handling. Remove sharing from paid-only upgrade copy and document free sharing separately.
- [ ] Run focused tests and required unit/typecheck/lint/build checks. Do not run e2e tests. Inspect changed copy at phone widths where useful.
- [ ] Obtain a fresh branch review. Apply/verify migration 053, then push once and create a PR closing #304. Require current-head Typecheck/Vercel green or verified quota exception, merge and verify production before #305.

Rollback: revert this PR and restore the original two restrictive policies from 049; keep all share rows/tokens and collection data.
