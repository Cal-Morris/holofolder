# Partner Acquisition Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the other partner's enabled devices when a printing is acquired in Show mode.

**Architecture:** Capture intent with collection edits, including the original actor and partnership. A service-role-only database RPC atomically saves the row and an idempotent pending event. Existing durable workflows deliver to individual subscriptions, revalidating membership and ownership on every attempt. Extend the existing service worker and Settings with explicit opt-in and device management.

**Tech Stack:** Supabase/Postgres, existing Workflow SDK, web-push/VAPID, React and existing IndexedDB store/service worker.

**Spec:** `docs/superpowers/specs/2026-11-07-collection-value-wanted-and-partner-push-design.md`

## Global Constraints

- Show-mode owned acquisitions only, including Got; no notifications for want additions, same-printing edits or imports.
- Exclude every device of the actor. Capture the original relationship, never notify a newly linked partner about an old acquisition.
- Preserve offline edits. A mismatched syncing actor suppresses push without silently reassigning authorship.
- No copied application code; independent application VAPID keys and standard protocol implementation.
- Missing schema/config disables enrollment and push without breaking collection saves.
- Never return/log subscription encryption keys or persist them in workflow inputs/outputs.
- No real-device test sends without explicit enrollment; distinguish push-service acceptance from device delivery.

## Review Focus

- Lost responses, queue compaction and conflict retries must create only one logical acquisition event.
- Unlinking, sign-out and device revocation must stop subsequent private deliveries.
- Collection save and event creation cannot be separated by a crash window.
- Expired subscriptions are removed; transient provider failures cannot roll back a saved collection edit.
- Untrusted endpoints, payload URLs and cached account identity cannot expose another account's notifications.

### Task 1: Pure intent and subscription contracts

**Files:** new `lib/partner-push.ts`, new `tests/partner-push.test.ts`, `lib/collection/offline-queue.ts`, `lib/collection/remote.ts`, `hooks/use-collection.ts`, `components/binder-app.tsx`.

**Interfaces:** normalize and validate acquisition context `{operationId, actorId, partnershipId, recipientId}`; create intent only for a new owned identity in Show mode. Normalize subscription endpoint/keys/device label. Keep acquisition metadata separate from collection row fingerprints.

- [ ] Write synthetic tests for transition detection, endpoint/key validation, identity mismatch, same-printing queue compaction, superseded/undone intent and legacy operations; observe RED.
- [ ] Implement intent helpers and carry optional metadata through direct writes, queued writes, normalization, compaction and conflict retries. Generate one operation ID before the first attempt and retain it on retry.
- [ ] Run affected collection/intent unit tests, expect GREEN.

### Task 2: Atomic save, subscriptions and durable events

**Files:** `scripts/044_partner_push.sql`, `scripts/MIGRATIONS.md`, new `lib/server/partner-push.ts`, new `app/api/push/subscriptions/route.ts`, new `app/api/push/recover/route.ts`, `app/api/collection/route.ts`, new `scripts/verify-partner-push.ts`.

- [ ] Inspect target schema and existing collection triggers before writing the migration. Use next free migration number.
- [ ] Add person-owned push subscriptions with owner-only RLS, private pending acquisition events and per-device delivery claims. Functions are service-role-only with pinned search paths.
- [ ] Add an atomic collection save RPC with row conflict detection, current binder/actor authorization and event insertion only for a verified captured partnership and owned transition. Deduplicate on actor/operation ID.
- [ ] Subscription APIs authenticate, validate standard push endpoints and keys, own-scope device mutations and return metadata only. Cap devices per person and remove expired rows.
- [ ] Collection POST uses the RPC after existing validation; missing RPC falls back to collection save without push. Return 409 on a concurrent state change.
- [ ] Add a rolled-back verifier for idempotent migration application, event deduplication, no-op/non-show changes, membership checks and subscription RLS without sending anything.

### Task 3: Durable delivery and recovery

**Files:** new `workflows/partner-acquisition-push.ts`, new `lib/server/push-delivery.ts`, `lib/server/partner-push.ts`, push API routes.

- [ ] Add web-push as a server-only dependency with types. Configure independent public/private keys and contact subject.
- [ ] Start a workflow only after the collection transaction commits. Keep events pending until durable start succeeds; recover pending own events on signed-in open/online sync.
- [ ] Workflow receives only event ID. Steps load subscriptions and secrets internally, verify current original partnership and current subscription owner, and use per-device leases/delivery markers to suppress duplicate sends.
- [ ] Use a finite TTL/socket timeout; delete 404/410 subscriptions; bounded retries for transient failures. Notification tags use event ID to coalesce replayed transport deliveries.
- [ ] Unit-test orchestration with mocked database/transport, including one expired device alongside a healthy one, self-exclusion, unlink and disabled devices on retry.

### Task 4: Enrollment, worker and account cleanup

**Files:** new `hooks/use-partner-push.ts`, new `components/partner-push-settings.tsx`, `components/settings-modal.tsx`, `components/binder-app.tsx`, `public/sw.js`, new `e2e/partner-push.e2e.ts`, `.env.example`.

- [ ] Explicit Enable action requests browser permission only on a tap, registers this device to the signed-in person and reconciles current account/subscription state. iOS without standalone installation gets install guidance; denied and unsupported states are clear.
- [ ] Show registered devices with disable/remove controls. Clean up locally before sign-out, then revoke remotely; never transfer an old account's active binding merely because a different user signed in.
- [ ] Keep a minimal current push-account binding in the existing IndexedDB store so the worker can avoid a private notification preview for a mismatched account.
- [ ] Worker validates JSON and same-origin destinations, shows the notification and opens/focuses the appropriate binder. Reuse the existing worker and caches.
- [ ] Test user gesture/permission branches, device/account cleanup, payload/click handling and six phone layouts with mocked transport. Verify the production-built worker/offline shell twice across all modes.

### Task 5: Ship and report proof

- [ ] Apply and verify only the task's numbered migration on the existing hosted project, ahead of code that uses it. Record schema and rolled-back verification results in the PR.
- [ ] Provision app-specific VAPID configuration securely without logging keys. Missing external access is a concrete deployment blocker, not a reason to invent credentials.
- [ ] Run unit, typecheck, lint, production build and full six-project e2e; fresh reviewer and substantive fixes before the single push.
- [ ] Open/link scoped dependent PR, merge only after gates, verify production. Explicitly state whether real enrolled-device delivery was tested.

## Verification and deployment record

- Applied `044_partner_push.sql` to the configured existing Supabase project. Verified it twice inside a rolled-back transaction, with owner/partner/stranger RLS, denied private RPC access, duplicate and conflict handling, original relationship checks and delivery leases. Latest verifier passes 23 checks, including EXPLAIN ANALYZE under each authenticated role. All synthetic verification rows rolled back, zero notifications sent.
- Configured a separate app-specific VAPID pair and contact subject for Production and Preview on the existing Vercel project. Private material stays outside the repository and logs.
- Review caught ignored post-claim read failures, now retried, and provider-queued messages arriving after unlink. Push payloads now contain event references only; the worker fetches private preview text through an authenticated endpoint that rechecks the original partnership at display and click time. Without authorization or connectivity, show a generic visible update. A push already accepted by a provider cannot be recalled; Web Push userVisibleOnly still requires a visible notification.
- Worker tests exercise current authorization, unlink, signout, account change and unsafe destinations. Browser tests exercise original partner intent through an offline purchase/reconnect, remote device removal, denial and user-gesture enrollment, and the installed Show-mode setup prompt.
- Actual notification delivery to a physical installed phone has not been tested. Automated tests use synthetic devices and never send to registered real devices.


## App routing reconciliation

- Rebased the unpublished feature onto routing releases #257 and #258. Framer owns marketing; this feature adds no marketing routes or domain settings.
- Subscription enrollment/revocation and recovery use `/app/api/push/*`. Device lookup targets the `/app` registration. Signout clears the existing account binding and subscription before attempting an offline-safe remote revoke.
- Private preview responses and worker notification clicks stay at `/app?binder=…`; generic updates open `/app`. Only app tabs are reused, leaving Framer marketing tabs untouched. Icons use `/app` asset URLs.
- Preserved `/app?service-worker=1` registration with `/app` scope, the v5 shell cache, legacy origin behavior, stable storage identifiers and queued edits. No VAPID rotation or additional schema change.
- Added regressions for app API preview paths, unsafe notification destinations, marketing-tab isolation and local signout cleanup while offline. Fresh six-project and production-build verification is required after reconciliation.

- Final routing-scoped validation: 936 unit tests, clean typecheck, lint at the existing 65 warnings, normal production build, and 297 repeated phone/offline cases passed with 9 browser-mode skips and no retries. Fresh review found the setup prompt's root API URL, corrected before the passing focused run.
- Cal explicitly waived per-PR full e2e in favor of one combined regression sweep after Push/Show releases. Stopped the incomplete sweep: 1,230 passed, 14 failed, 78 skipped, 3 interrupted and 1,543 not run. Home/set-highlight failures include stale root-image URL assertions; not-found expects the old Next homepage instead of Framer. Scan failures remain undiagnosed and are carried into the combined sweep. This is not a full-suite pass.

- Final release reconciliation onto `24246a4` preserves Show duplicate protection, finish-aware wanted removal, revisit/budget keys and SVG/icon exports. Notification icon uses `/app/pwa-holo-cards-192.png`. On this final base: 949 unit tests, clean typecheck, existing 65 lint warnings and normal production build pass. The 297-case focused run predates the Show rebase; no additional browser run was started, per Cal's combined-sweep instruction.
