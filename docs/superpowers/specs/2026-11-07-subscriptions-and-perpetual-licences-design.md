# Holo Folder subscriptions and perpetual licences

## Approved product rules

Holo Folder charges for access through the existing Syncaura Stripe account, already connected to the `cal-morris/holofolder` Vercel project. Use Stripe Billing and hosted Checkout. Do not create another Stripe account, sandbox or Connect platform.

- Free accounts may save 10 cards across all their binders, including wanted cards. They cannot share binders, use partner mode or check sold comps.
- Paid access costs £2.99/month or £29.99/year in GBP. Both prices unlock the same top tier with unlimited cards, sharing, partner mode and sold comps.
- One owner's entitlement covers that owner's shared collection and partner. The partner cannot manage the owner's billing.
- Cancellation keeps access until the paid period ends. When access ends, retain every card and allow the owner to view and remove cards. Block additions above the free limit, public sharing and partner access. Retain partnership and share records so access can resume without recreating them.
- Existing accounts receive permanent top-tier access with no billing subscription. Support account-level perpetual licences independently of Stripe subscriptions, so they survive reinstalls and device changes and can also be granted to accounts later.

## Implementation decisions

These are builder choices, not additional requests from Cal.

### Permanent access and the grandfather cutoff

At the first application of the billing migration, persist an immutable UTC grandfather cutoff and grant a perpetual licence to all existing Supabase auth users created before that cutoff. This deliberately includes existing accounts without cards, protecting early users across the app. Repeat application uses the original cutoff and cannot grandfather new registrations. No recurring Stripe objects are created for licence holders. A licence applies to every binder of the account, including future binders. It is not a transferable binder property: a new account does not acquire permanent access by receiving a share link or joining a partner.

A licence has owner user ID, grant time and a source (`grandfathered` or `manual`). Only trusted service-role/admin operations can grant it. No licence-selling checkout or admin dashboard is in scope. No expiration field: perpetual means permanent. Subscription changes must never overwrite this licence.

Anonymous on-device binders have no trustworthy server account identity or installation timestamp. Preserve their cards and queue, but do not grant a permanent account licence based on client-provided data. Existing signed-in accounts are the automatic grandfathering boundary. Any exceptions can be granted manually by account ID.

### Card counting

Count saved entries across all binders belonging to the collection owner, not per device or binder: one for an owned/considering/finalized National Dex slot, even without a selected printing, plus one for each saved wanted-card entry. A wishlisted-only row with wanted entries counts those entries; a legacy wishlisted-only row with no entries counts one. Duplicates saved in different binders count separately. The count cannot decrease by changing metadata or changing owned status to wishlisted without actually removing saved entries. Existing over-limit collections are retained. Updates that do not increase count, replacements of an existing printing and deletions remain allowed. Guests get the same local limit; signing in must not discard their excess existing data.

### Access and lifecycle

Keep one shared entitlement contract: effective access is the owner's perpetual licence OR an eligible Holo Folder subscription whose paid access has not expired. Free limits apply when neither exists. Do not infer access from an email address, a publishable key, a success URL or user-editable metadata. Inactive partner accounts keep access to their own data; they cannot read or write the owner's shared collection until that owner has paid or perpetual access. Preserve the relationship so it can reactivate.

For subscriptions, keep a server-owned user-to-customer mapping and paid-through timestamp. Subscription status alone must not advance the paid-through timestamp on an unpaid renewal. Successful Holo Folder invoice payment advances access; a failed renewal cannot revoke already-paid time or grant another unpaid period. No trial is offered. Unpaid/incomplete/expired/paused subscriptions do not open access. Cancellation at period end leaves paid access until expiry; immediate cancellation ends subscription entitlement. A perpetual licence wins in every case. Billing reads refresh on return from Checkout/portal and on reconnect/visibility, without putting private responses in shared caches.

Hosted Checkout accepts only a server-side allowlisted monthly/yearly Holo Folder price, quantity one. Associate the authenticated owner using server metadata. Check for permanent access, current subscriptions and open Checkout sessions to avoid duplicate purchases, and make creation idempotent. The billing portal uses a Holo Folder-specific configuration and supports payment-method management, invoices and cancellation at period end. Do not alter Syncaura's global branding, other products, customer subscriptions or default portal configuration.

Verify webhook signatures over the raw request body. Handle only this app's mapped customers and approved prices; acknowledge unrelated Syncaura events without changing entitlements. Process successful invoices and subscription lifecycle changes. Repeated or reordered events must not regress paid access: reconcile authoritative Stripe state with serialized updates per billing owner, and record processing only after the database commit. Retry failed processing. Match test/live mode to configuration.

### Enforcement and offline behavior

Enforce collection totals transactionally in Postgres with serialization per collection owner, covering direct PostgREST writes, imports, multi-row operations and service-role API writes. Client prompts improve UX but are not the security boundary. An update must not transfer a row to a different owner or bypass the cap by moving binders/status. Apply partner access checks to collection, binders, settings, appearance, history, show purchases and partner push paths, including RLS and SECURITY DEFINER functions. Invites/acceptance require the owner's entitlement; removal or rejecting an invite stays available.

Gate public share reads as well as enabling shares. Gate saved and refreshed price-check responses before reading shared cached provider results. This gate covers the existing eBay listings and sold-comps comparison panel together; public catalogue guide prices remain available. Do not change pricing confidence or invent evidence.

Cache the last-known entitlement and total with account/owner identity for offline display. Server/database enforcement remains authoritative. Offline checkout and live price checks explain that a connection is required. Paid/perpetual owners can continue editing offline using their last-known access; subscription access expires at the saved paid-through time. Unknown offline entitlement never means unlimited access. Keep queued edits across entitlement changes. An entitlement/cap rejection pauses the edit with an upgrade message instead of discarding or continually retrying it; upgrading/reducing the count resumes it. Other existing hard errors retain their current behavior. A sign-out or account switch must not reuse another account's entitlement or expose a suspended partner's data through cached startup.

### UI and routing

Reuse Settings → Account for plan details, free usage, Monthly/Yearly upgrade buttons and Manage billing. Permanent users see `Lifetime access` and no purchase prompt. Partners see the owner's shared access and cannot open the owner's portal. Reuse the existing settings and overlay primitives, rather than introduce a separate paywall modal; gated actions route to the Account tab with contextual upgrade copy. Replace any open overlay first. All mobile widths, safe areas and dismissal methods remain supported.

Raw API calls and return URLs include `/app`. Configure canonical public return URLs under `https://holofolder.com/app`; do not trust arbitrary forwarded hosts. The webhook may use the verified Vercel origin `https://app.holofolder.com/app/api/billing/webhook` to avoid Framer transformations. Protect state-changing routes against cross-site requests using the existing public-origin rules. All billing responses use private/no-store caching. Stripe Node SDK remains server-only; hosted Checkout does not need Stripe.js in the binder bundle.

### Rollout and proof

Create an additive migration with a persisted enforcement switch initially off. Backfill perpetual licences and verify existing accounts before enforcement. Deploy billing-aware code with an absent-schema compatibility path, configure Holo Folder-only Stripe prices/webhook/portal and verify processing, then enable the switch. Before schema exists, preserve the current app while making billing actions clearly unavailable; once enforcement is enabled, entitlement lookup failures cannot grant new premium access.

Use synthetic fixtures/mocks for application tests and separate test-mode Stripe credentials for any real payment lifecycle test. Never submit a real payment with the connected live keys just to test. Inspect credentials without printing them. Do not mix live keys into preview/development verification. Shipping requires configured and verified live resources, migrations applied and checked, all local checks, a PR, merge gates, and production smoke verification. If live/test credentials or permissions are unavailable, report that exact blocker and proof gap rather than claim billing is live.

## References

- https://docs.stripe.com/payments/checkout/build-subscriptions
- https://docs.stripe.com/billing/subscriptions/webhooks
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/customer-management/integrate-customer-portal
- Repository `AGENTS.md`, `docs/app-routing.md` and the database, offline, mobile and release skills.
