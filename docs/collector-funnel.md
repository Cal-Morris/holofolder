# Collector funnel

This is an observed, best-effort product funnel on the existing Supabase/Vercel plan. Existing aggregate Vercel page views remain. Vercel [custom events](https://vercel.com/docs/analytics/custom-events) are a paid-plan feature; no new analytics subscription is needed here. Stripe remains the source of truth for revenue and subscription status.

## Rollout and privacy

Migration 054 creates private `collector_accounts` and `collector_events` tables. The app works without them: event failures never fail the primary action. Production additionally requires `HOLOFOLDER_FUNNEL_ENABLED=true`; development and preview are excluded even if this flag is set. Leave the flag unset/false until the Framer privacy notice below is published. Enable it in Production, deploy the latest main, and verify both the exact deployment and first observed events. An env change alone does not change an existing deployment. No source capture or client event requests run while the provider is disabled.

The final Framer marketing branch must update Privacy with matching substance before enablement:

> When you sign in, we use your existing account and collection-owner identifiers to understand app use, collection activation and subscription conversion. We record daily app opens, successful-save milestones, upgrade views, created checkouts and verified payment/cancellation events. We attach only approved campaign/source labels; we do not include email addresses, full URLs, card names, tokens or free-text event data. A source-only record may remain in this tab's session storage for up to two hours across sign-in, then is cleared after a successful account observation. It contains no anonymous identifier. Granular events are retained for 90 days and removed through an explicit maintenance action; first-save, activation, first-paid and first-touch account records remain until account deletion so milestones and attribution do not reset. Account deletion removes these records. Aggregate website analytics are separate. Contact contact@holofolder.com about account data.

No historical activation is invented. When tracking begins for an existing binder, the first observed successful write and persisted count can establish observed milestones, not the collector's historical first-ever use. Disabled periods, missing tables, network loss, post-response execution limits and tracking failures create gaps. Client events are not added to the collection edit queue. A successful response or verified invoice can outlive a lost observation.

## Data and boundaries

`collector_accounts` retains first-observed source/medium/campaign once, with a first owner-observation time for cohort entry. A partner's source stays on their own account. An owner first observed through a partner save or billing backfill has unknown attribution rather than inheriting the partner's campaign. A missing source remains unknown; no raw UTM value is retained. Approved slugs are maintained in `lib/collector-funnel.ts` and migration 054. Examples: source `youtube`, medium `social`, campaign `launch`. Unapproved values, including personal creator names, become unknown.

`collector_events` stores only actor/owner UUIDs, an enumerated event name, event time, bounded dedupe key, optional import/manual origin and verified Stripe subscription service-period identifiers/times. There is no arbitrary JSON. Account deletion cascades through both owner and actor references. All client roles lack read/write privileges and RLS has no client policy; the authenticated same-origin endpoint derives actor and owner server-side and accepts only app-open and upgrade-view observations. Service-role-only functions and inserts are used for trusted events. Reports are operator-only.

Successful POST/PATCH collection writes schedule milestones with Next `after`, after the response. The saved-entry count comes from the existing server billing RPC across all owner binders and wanted entries. Optimistic/offline writes count only on server persistence. The queued `importOnly` flag sends an import origin; it does not grant privileges or create a milestone without a successful save.

App opens and upgrade views dedupe by owner, actor, event and UTC day. Server milestones have permanent owner keys. Created Checkouts dedupe by session ID, with the actual session creation time; reusing a session is not a new creation. Checkout return URLs never imply payment. Only allowlisted, metadata-verified Holo Folder subscriptions and positive GBP paid invoices qualify. Complete bounded history (at most 500 subscriptions and invoices per customer) determines the earliest real paid invoice even when webhooks arrive out of order. Missing paid times, truncated lines/history or ambiguous service periods cannot establish a false first payment. `paid_invoice` rows preserve service-period evidence, `first_paid` is durable, and `renewed` requires a later subscription-cycle invoice. Scheduled/immediate cancellation uses verified current subscription state and Stripe cancellation timestamps. Replays use stable keys. Failures remain harmless and backfillable for payments.

## Report and retention

Read-only by default, with a Supabase service-role environment:

```sh
bun --env-file=.env.local scripts/report-collector-funnel.ts --from=2026-11-01 --to=2026-12-01
```

`from` is inclusive, `to` exclusive and capped to now. Reports paginate past PostgREST's 1,000-row cap. Groups include source, medium and campaign, preserving unknown. The unit is a collection owner first observed in the cohort window. First save, activation at 10 persisted entries, upgrade, Checkout and first-paid stages must appear in order; missing or earlier stages cannot be inferred. `observedPaid` separately shows observed first payments without claiming a complete ordered funnel. Imports can activate an owner and are counted separately. Daily upgrade deduplication and lost events make ordered conversion conservative.

Retention denominator includes activated owners with at least one later UTC date in the observation window. Return requires that owner's own app-open on a later UTC date after activation. A partner open and same-day reopen do not count. Renewal eligibility includes owners with a verified positive paid service period ending within the window; renewal requires a later subscription-cycle invoice with the same subscription and a start matching that period end. Annual periods that have not ended are excluded. Counts/rates use unique owners, not event totals. Cancellation is separately counted. These eligibility and observation limitations are part of every report's coverage note.

Explicitly remove one bounded batch of granular rows older than 90 days:

```sh
bun --env-file=.env.local scripts/report-collector-funnel.ts --cleanup --limit=100
```

The cleanup flag is required; reporting never cleans implicitly. Maximum 500 rows per invocation. First-save, activation and first-paid milestones are excluded by both selection and deletion guards, so cleanup cannot reset first-payment classification. First-touch records remain until account deletion. There is no unrelated cron or background cleanup job; run explicit maintenance as needed to enforce retention.

An explicit payment-only backfill is available **after privacy publication and production enablement**, with the existing Stripe secret in the operator environment:

```sh
VERCEL_ENV=production HOLOFOLDER_FUNNEL_ENABLED=true bun --conditions=react-server --env-file=.env.local scripts/report-collector-funnel.ts --backfill-paid --limit=25
```

At most 100 Holo Folder billing accounts per invocation, at most 500 invoices/subscriptions each. Continue a bounded batch with `--after-owner=<nextOwnerCursor>` from the previous result. It reads Stripe and writes deduplicated verified observations only, never charges, creates a Checkout or changes subscriptions. It reports skipped/incomplete histories. Complete history still determines the durable first payment, but granular events older than 90 days are never re-created after cleanup. It does not invent historical first-seen, activation or campaign data. Repeated runs are idempotent. The report flags gaps rather than treating missing events as evidence of no activity.

## Verification and rollback

`scripts/verify-collector-funnel.ts --hosted-rollback` requires an explicit `COLLECTOR_FUNNEL_TEST_DATABASE_URL`. It applies migration 054 twice within a rolled-back transaction and checks immutable first touch, dedupe, retention, service-role access, owner/stranger/anonymous denial, account-deletion cascades and a rolled-back EXPLAIN ANALYZE. All fixture rows and verification DDL roll back. The task then applies only migration 054 to the hosted project and verifies empty tables and permissions while tracking remains disabled.

Disable the flag and deploy the latest main to stop collection. Revert this PR for code rollback; retain private tables for retention/deletion handling. Dropping tables is not required and is not part of rollback. The Framer privacy copy and Vercel flag are external configuration, so a Git revert does not undo them.

Shipping verification, 8 November 2026: migration 054 was applied to the existing hosted Supabase project after the double-application rollback verification. Both tables are empty and have RLS enabled. Authenticated table reads/RPC execution are denied; service-role writes/RPC execution are granted. The operator report runs read-only and returns an empty cohort. The Vercel project has no `HOLOFOLDER_FUNNEL_ENABLED` variable, so collection remains disabled pending the final Framer privacy publish. No Stripe charges or subscription changes were made for validation.
