# Subscriptions and perpetual licences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charge new Holo Folder accounts £2.99/month or £29.99/year while permanently unlocking existing accounts without a subscription.

**Architecture:** Postgres stores trusted perpetual licences and subscription access; a single owner entitlement resolver drives RLS, transactional caps, server APIs and client upgrade prompts. Hosted Stripe Checkout and a Holo Folder-specific billing portal use the existing Syncaura account. Signed webhook reconciliation updates only this app's subscriptions.

**Tech Stack:** Next.js 16.4.5, React 19, Bun, Supabase/Postgres, Stripe Node SDK, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-subscriptions-and-perpetual-licences-design.md`

## Global Constraints

- Free: 10 saved cards across all binders, including wanted cards. Paid: £2.99/month or £29.99/year in GBP.
- Existing accounts receive permanent top-tier access with no billing subscription.
- One owner's entitlement covers that owner's shared collection and partner. The partner cannot manage the owner's billing.
- Cancellation keeps access until the paid period ends; cards and queued edits are never deleted by a billing transition.
- Use Syncaura; isolate Holo Folder products, customers and webhook processing. Do not change account-wide Stripe settings.
- No new lint warnings, clean typecheck, unit tests for new logic, e2e on all six viewport/PWA projects.
- Local test port 3287; `--workers=2`. Never kill another agent's server. Never print or commit secrets.
- Preserve existing unrelated untracked marketing/named-share documents.

## Review Focus

1. Reapplying migrations must not grant lifetime access to new users.
2. Concurrent additions in different binders must not exceed the account cap.
3. Billing expiry must preserve queued edits and must block stale share links and partner data, including cached startup.
4. Duplicate/out-of-order Stripe events and unrelated Syncaura events must not grant or regress Holo Folder access.
5. A perpetual account must never lose access due to any Stripe subscription state or be prompted to buy unnecessarily.

---

### Task 1: Trusted entitlements and permanent licences

**Files:** create `lib/billing.ts`, `lib/server/billing.ts`, `scripts/049_billing_access.sql`, `tests/billing.test.ts`, `tests/billing-access-migration.sql`; modify `scripts/MIGRATIONS.md`. Recheck next free migration number before writing.

**Interfaces:** `BillingAccess` includes `ownerUserId`, `tier` (`free` or `paid`), `source` (`free`, `subscription`, `perpetual`), `paidThrough`, `savedCardCount`, `cardLimit` and `enforced`. `getBillingAccess(ownerUserId: string): Promise<BillingAccess>` loads server-owned access. `countSavedCards(items: CollectedPokemon[]): number` implements the exact spec count. No raw Stripe IDs need to reach the client.

- [ ] Write failing `billing.test.ts` cases: 10 versus 11 entries, owned plus multiple wants, legacy wishlisted row, duplicate printings in separate binders, permanent access overriding canceled/expired subscriptions, and expired paid-through timestamps.
- [ ] Run `bun test tests/billing.test.ts`; confirm failures are missing behavior.
- [ ] Add account-level perpetual licence storage, customer/subscription mapping, paid-through state and a private billing configuration row with immutable grandfather cutoff and `enforced=false`. Authenticated clients cannot edit them.
- [ ] Backfill every auth user created before the first persisted cutoff. Repeat safely with original cutoff; no Stripe objects. Add normalized entitlement reads and missing-schema compatibility as specified.
- [ ] Run the unit tests and a rolled-back SQL check for existing user, new user, perpetual user, subscription user and stranger; apply migration twice in scratch if available. Assert a new user remains free after rerun.

### Task 2: Database cap and partner access

**Files:** extend `scripts/049_billing_access.sql`, `tests/billing-access-migration.sql`; modify `lib/server/collection-owner.ts`, `app/api/collection/route.ts`, `app/api/binders/route.ts`, `app/api/settings/route.ts`, `lib/server/binder-appearance.ts`, `lib/server/partner-push.ts`, `workflows/partner-acquisition-push.ts`, `app/api/push/events/[id]/route.ts`, `hooks/use-partner.ts`, and relevant existing collection/partner tests.

**Interfaces:** shared `BillingAccessError` uses structured `upgrade_required`/`card_limit_reached` codes. Database entitlement and slot-weight functions match Task 1. Partner membership resolution preserves relationship metadata while refusing unpaid owner data access.

- [ ] Add failing SQL cases for two concurrent free inserts at count 9 in different binders, multi-row import, wanted-array expansion, metadata-only update above cap, removal, owner transfer, stranger and service-role writes.
- [ ] Add failing tests for a licensed owner with an unlicensed partner, free owner with a paying partner, and expiry/reactivation without deleting a partnership.
- [ ] Enforce the per-owner saved-card count under transaction serialization with a trigger so service-role and direct PostgREST imports are covered. Permit updates that do not grow the count and permit deletes. Keep the switch off during initial rollout.
- [ ] Audit every partner-shared policy from migrations 007/033/039/041/043/044 and current schema; add owner entitlement to all shared collection/settings/binder/appearance/history/show-purchase reads and writes, partner invites/acceptance, privileged RPCs, push delivery and API owner resolution. Preserve owner access and partner removal/rejection.
- [ ] Run SQL checks as owner, partner, stranger and anon; verify representative `EXPLAIN (ANALYZE, BUFFERS)` under rollback. Verify no bypass through existing atomic acquisition RPC, direct imports or Realtime channels.

### Task 3: Checkout, portal and webhook lifecycle

**Files:** create `lib/server/stripe.ts`, `lib/server/billing-subscriptions.ts`, `app/api/billing/route.ts`, `app/api/billing/checkout/route.ts`, `app/api/billing/portal/route.ts`, `app/api/billing/webhook/route.ts`, `tests/billing-subscriptions.test.ts`; modify `.env.example`, `package.json`, `bun.lock`, billing SQL as needed. Read the installed Next route-handler docs before implementation.

**Interfaces:** `GET /app/api/billing` returns effective access plus whether the actor may manage billing. `POST checkout` accepts `{ interval: "month" | "year" }` only and returns `{ url }`. `POST portal` returns `{ url }`. Webhooks verify raw signatures and update only mapped Holo Folder subscriptions.

- [ ] Write failing tests for unsigned/invalid events, unrelated products/customer metadata, wrong mode, unpaid initial checkout, paid renewal, failed renewal retaining only already-paid time, period-end and immediate cancellation, duplicate and reordered events, concurrent/repeated Checkout, and a perpetual account attempting Checkout.
- [ ] Install the current Stripe Node SDK and use server-only lazy initialization; add documented price IDs, webhook secret and app-specific portal configuration ID without values.
- [ ] Build authenticated, origin-checked, no-store checkout and portal routes using fixed canonical `/app` return URLs and server-allowlisted recurring prices. Bind customer creation/session reuse to trusted user ID and idempotency keys. Reconcile existing subscriptions before offering another purchase.
- [ ] Implement signature-required webhook reconciliation with app/customer/price/mode scoping, per-owner serialized updates, retryable failures and processing deduplication recorded after successful state persistence. Advance paid-through only from verified paid invoices; handle cancellation and expiry independently of permanent licences.
- [ ] Run billing unit tests and route-level regression tests with synthetic Stripe fixtures and mocked I/O. Never submit live charges.

### Task 4: Free/paid UI and offline-safe gates

**Files:** create `hooks/use-billing.ts`, `components/billing-settings.tsx`, `e2e/billing.e2e.ts`; modify `components/binder-app.tsx`, `components/settings-modal.tsx`, `components/card-price-comparison.tsx`, `app/api/card-price-checks/route.ts`, `app/api/binder-share/route.ts`, `app/share/[token]/page.tsx`, `components/binder-start.tsx`, `lib/binder-start.ts`, `components/offline-app-shell.tsx`, `hooks/use-collection.ts`, `lib/collection/remote.ts`, `lib/collection/sync.ts`, `lib/collection/offline-queue.ts`, `e2e/fixtures.ts`, `app/e2e-harness/page.tsx`, related offline/collection tests. Check other price-check displays, not only the comparison panel.

**Interfaces:** account/owner-scoped `useBilling` exposes normalized access, loading/error, refresh, checkout and portal actions. Billing-specific collection errors pause persisted queued operations without classifying them as permanent hard failures. Existing HTTP/status contracts remain supported.

- [ ] Write failing tests: lifetime users see `Lifetime access` with no upgrade, free count 10 opens Account upgrade, annual/monthly actions, paid cancellation time, partner cannot manage owner's billing, old share link blocked when owner loses access, and free direct GET/POST comps denied before provider/cache access.
- [ ] Write failing queue tests proving an entitlement rejection retains the edited item and durable operation across reload, pauses retries, and resumes after upgrade or count reduction; account switching cannot reuse access or suspended partner startup data.
- [ ] Reuse Settings Account for pricing, usage and subscription management. Gated actions replace overlays then open Account; authenticated perpetual access avoids Checkout. Guests see sign-in before purchase. Offline actions explain connection requirements.
- [ ] Carry scoped access through server boot, local marker and offline shell without shared HTML caching. Use last-known paid-through to limit subscription access; perpetual access is not time-limited. Never purge user cards or queued edits after expiry.
- [ ] Gate public share reads and share enablement; allow disabling/deleting. Gate cached/refreshed comps and hide stale on-device paid comparison UI when effective access is free. Keep public catalogue guide prices unchanged.
- [ ] Run `e2e/billing.e2e.ts` on all six projects three times using own port 3287 and two workers, including safe areas, tap targets, no overflow, overlay dismissal and offline reload. Extend actual-worker coverage for paused edits/entitlement startup and repeat at least twice.

### Task 5: Syncaura configuration and staged deployment

**Files:** create `scripts/setup-stripe-billing.ts` and `docs/billing.md`; update `.env.example` and migration docs. The script defaults to read-only/dry-run and requires explicit apply for Holo Folder resource creation.

**Interfaces:** configuration tooling identifies only app-tagged GBP prices (299/month and 2999/year), app-specific portal and webhook; no secrets in stdout. Existing unrelated Syncaura resources are untouched. Perpetual manual grants use trusted account-ID SQL documented in `docs/billing.md`, with no client API.

- [ ] Verify the connected Stripe account identity securely before creating resources; inventory existing app-tagged resources. Reuse exact matches, create only missing Holo Folder product/prices/portal/webhook and record IDs without keys. Do not re-provision Vercel integration.
- [ ] Use test credentials for real Stripe lifecycle checks if available. Ensure preview/development do not perform live payment tests. If permissions or test credentials are missing, report the exact blocked verification rather than use live payments.
- [ ] Inspect hosted schema and apply only required unapplied migrations in order with enforcement off. Verify grandfathered licence counts against the recorded cutoff, sample existing accounts, repeat-application behavior, new-account exclusion and RLS.
- [ ] Complete Task 6 local checks before first push. Set required Vercel config/secrets securely; deploy billing-aware code, verify webhook delivery/reconciliation and public `/app` returns, then enable enforcement. Confirm grandfathered owners/partners remain paid without billing subscriptions.

### Task 6: Review, PR and production proof

**Files:** final focused diff only; no unrelated marketing/share docs or secrets.

- [ ] Use a short-lived branch off current `origin/main` and isolate shared work before edits. Recheck migration numbering and repo instructions. Implement tasks directly in this session unless Cal requests delegation.
- [ ] Run `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`, then `E2E_PORT=3287 bun run test:e2e --workers=2` across all six projects. Address failures and lower lint cap if warnings were removed.
- [ ] Review actual diff for RLS bypass, webhook races, duplicate billing, Stripe app isolation, stale cached entitlements and queued-write preservation. Document any proof gaps and deployment order.
- [ ] Commit scoped changes, push once, open a reviewer-facing PR including applied migration results, licence backfill counts, exact validation and rollout state; link PR to the thread immediately.
- [ ] Inspect exact-head checks/reviews; merge only on green Typecheck and Vercel or the verified quota exception. If waiting on checks, use the PR watch tool rather than polling.
- [ ] Verify exact merge commit production deployment, existing perpetual account, new free account, free count enforcement and share/comps denial. Verify live webhook is registered and reachable without creating a real charge. Report payment-test limits explicitly and do not call release complete while required deployment/configuration remains pending.

## Execution overrides and rollout record

- Cal explicitly said `no e2e` during execution. Do not add or run further e2e. Use unit, typecheck, lint, build and database verification, and disclose missing browser/PWA proof.
- Local port 3287 was occupied; only own temporary servers were started/stopped at 3288 and 3289.
- Migration 049 applied on hosted Supabase, cutoff `2026-11-07T21:13:57.946Z`: 2 eligible existing accounts and 2 grandfathered perpetual licences verified, enforcement still off pending deployment.
- Syncaura account identity verified. Holo Folder-only monthly/yearly prices, portal and webhook created; production environment configuration prepared without logging keys.
