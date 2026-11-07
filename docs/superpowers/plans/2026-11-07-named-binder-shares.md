# Named Binder Shares Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let accounts and binders name their shared URLs as holofolder.com/@cal/national.

**Architecture:** Separate account identity and binder public identity from shared collection settings. Store active names plus reservations transactionally, then resolve names to the existing enabled binder share and renderer. Keep token URLs compatible.

**Tech Stack:** Supabase Postgres/RLS, Next.js App Router, React, Bun, Playwright, Framer Multi Site.

**Spec:** docs/superpowers/specs/2026-11-07-marketing-style-and-named-shares-design.md

## Global Constraints

- Usernames: lowercase ASCII letters/digits/hyphens, 3–30 chars, alphanumeric first/last; globally unique, case-insensitive.
- Binder slugs: same rules, 1–60 chars, unique within owner. No automatic publication or changes on display-name rename.
- Only account holder edits username; only binder owner edits slug. Partners still use existing sharing actions.
- Names editable; old published addresses become 404 and remain reserved to the original account/binder.
- Both token and named addresses require enabled share; noindex, no profile/directory, no private cache fallback.
- Existing /app basePath, storage keys, pricing/collection behavior and token links remain compatible.
- Missing migration disables new identity controls clearly while old sharing continues to work.

## Review Focus

- Concurrent claims/renames must never assign one public address to two accounts or expose another binder.
- Username belongs to the authenticated account, not the partnership's collection owner.
- Deleted/disabled shares and historic reservations must never fall back to a default binder.
- A clean external URL must hydrate and fetch assets/APIs correctly behind Framer's different internal path.
- Offline public navigation must never reveal the device's cached private binder.

### Task 1: Identity schema, transactions and pure contract

**Files:** Create scripts/045_named_binder_shares.sql (reserved before independent 046), lib/public-binder-identity.ts, tests/public-binder-identity.test.ts; modify scripts/MIGRATIONS.md.

**Interfaces:** normalizeUsername(value: unknown): string | null; normalizeBinderSlug(value: unknown): string | null; suggestBinderSlug(name: string): string; buildNamedBinderSharePath(username: string, slug: string): string. Separate active identity rows and historical reservations, maintained by authenticated transactional SQL functions. Exact table/function names settled in the ledger before SQL implementation.

- [ ] Write failing tests for lowercase/trim normalization, boundary lengths, invalid punctuation/path characters, empty values, and /@cal/national URL generation.
- [ ] Implement pure normalization and suggestion helpers; run targeted tests to green.
- [ ] Write idempotent schema and authenticated transactional claim/rename functions with unique indexes, owner authorization, pinned search_path and reservations that cannot be reassigned on deletes. Use auth.uid() from the verified session, not a caller-supplied identity. Public lookup is service-role only and matches active identities, owner/binder association and enabled share.
- [ ] Exercise SQL twice on scratch/rolled-back target setup; prove concurrent/case-insensitive uniqueness, reservation reuse only by original identity, owner/partner/stranger authorization and deletion behavior. Use authenticated RPCs for writes, not a service-role function accepting arbitrary actor ids.
- [ ] Document migration and backwards-compatible rollout, then commit.

### Task 2: Identity settings and sharing integration

**Files:** Create app/api/account-identity/route.ts, app/api/binder-identity/route.ts, components/account-username-settings.tsx, components/binder-slug-settings.tsx, hooks/use-public-binder-identity.ts; modify components/settings-modal.tsx, components/binder-app.tsx, app/api/binder-share/route.ts, lib/binder-share.ts and e2e fixtures only as needed. Add e2e/named-binder-shares.e2e.ts and API authorization tests following existing patterns.

**Interfaces:** GET/PATCH /app/api/account-identity returns {username: string|null, available: boolean}, PATCH accepts {username}; GET/PATCH /app/api/binder-identity?binderId= returns {username: string|null, slug: string|null, canEdit: boolean, available: boolean}, PATCH accepts {binderId, slug}. Return 400 validation, 401 auth, 403 ownership, 409 conflict/reservation, 503 missing schema; all responses no-store. Existing share response path selects named URL only when owner username and binder slug exist, otherwise token path.

- [ ] Write failing owner/partner/stranger, taken/invalid, pending save, offline and missing-schema tests.
- [ ] Implement authenticated endpoints with locally verified reads, getUser writes, validated inputs, transactional claim RPCs and safe errors. Signed-in user identity is distinct from collection-owner identity.
- [ ] Add explicit labelled save fields, rename warning, saved URL preview, pending/error/success states and offline explanation in the existing Account/Share settings tabs. Pass active binder id/owner without duplicating BinderSettings types.
- [ ] Update all URL consumers to accept arbitrary server-returned share paths; remove the current settings token extraction/reconstruction. Canonical production named URLs use holofolder.com, preview/local remain testable without sharing a preview-only production URL.
- [ ] Run pure/API tests and new e2e on all six projects, repeated for async UI behavior. Confirm existing header/settings copy, enable and disable flows and old token fallback.
- [ ] Commit the settings/integration change.

### Task 3: Public renderer, worker boundary and rollout

**Files:** Create app/u/[username]/[binderSlug]/page.tsx and a shared renderer under lib/server/ or components/; refactor app/share/[token]/page.tsx only to reuse rendering. Modify public/sw.js, docs/app-routing.md, appropriate auth/public-route tests, tests/binder-share.test.ts and offline e2e.

**Interfaces:** Named route resolves only active account/binder names, then returns the same enabled BinderShareRecord as the token resolver. Both routes share one data/rendering path, explicitly scoped to the resolved binder. No fallback on invalid/deleted/disabled public resolution.

- [ ] Write failing tests for named lookup, disabled/deleted/unknown/historic identities, authenticated public access, exact binder isolation and no private offline shell for /@... and /app/u/....
- [ ] Implement noindex server route and common read-only rendering, sanitize public bootstrap, preserve existing legacy token semantics and prevent public-data caches from bypassing revocation. Check all public data reads currently using shareViewToken.
- [ ] Exclude /app/u from service-worker shell fallback and ensure /@ paths remain outside its handled navigation boundary. Update worker cache version only if required for consistent activation; retain image/user-storage identifiers.
- [ ] Document Framer External /@*/* -> https://app.holofolder.com/app/u/:1/:2, existing /app rules and deployment order. Validate hydration/query strings/navigation on an emulated rewrite and later actual Framer.
- [ ] Run every required local check, all six e2e projects, and get fresh whole-branch security/contract review. Inspect target Supabase schema, apply only required unapplied migrations in numeric order, verify RLS/concurrency/constraints/query plans, record proof in PR.
- [ ] Commit/push once, create/link PR, verify exact head and merge gates, merge and verify production origin. Hand Cal the ready-to-publish Framer rule, then verify the actual public URL after Cal configures it. Until then, report only the Framer external routing gate as pending.

## Execution record

Implemented inline after Cal’s existing approval. The two name fields share `components/public-name-settings.tsx`; API helpers live in `lib/server/public-binder-identity.ts`, avoiding separate hooks/components for the same form. Names are reserved from claim time, which also protects unpublished names without extra publication history.

Migration045 was applied and verified on the existing hosted project: 25 rolled-back SQL checks, resolver EXPLAIN ANALYZE, concurrent username/slug claims and cleanup. 976 unit tests, typecheck, lint64 and production build pass. Final security review’s inherited read-only storage mutation was guarded. Browser/e2e/device/real-worker/proxy checks are explicitly skipped under Cal’s global pause. New e2e coverage is written but unrun. Framer configuration and published hydration remain external rollout gates, not proven by origin checks.

Use an ignored per-plan ledger for exact schema choices, authorization and validation proof. Migration 045 was reserved for this work before the independent 046 release. It is now applied and verified.
