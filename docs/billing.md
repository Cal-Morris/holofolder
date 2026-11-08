# Billing and lifetime access

Holo Folder uses its own product, recurring GBP prices, customers and portal configuration in the existing Syncaura Stripe account. It does not use Stripe Connect. The plans are £3.99/month and £34.99/year, saving £12.89 against twelve monthly payments. After migration 052, the free allowance is 100 saved entries across all binders, including individual wanted cards, and one binder. One owner's paid access includes their shared partner collection; billing is per owner, never per binder or per person. Paid/lifetime owners can create multiple binders within the existing 20-binder safety ceiling.

## Automatic Premium trial

Migration 056 grants full Premium automatically for 168 hours from the collection owner's `auth.users.created_at`, including their partner. Accounts already less than seven days old get the remaining time, not a fresh trial at deployment. Lifetime licences and active paid subscriptions take precedence. The trial creates no Stripe customer or subscription, needs no payment details and never converts into a charge. Choosing a monthly or annual purchase still opens the existing paid Checkout.

The database uses the trusted signup timestamp for premium checks and returns the expiry to the app. Settings shows the trial terms and local expiry time; the scoped offline billing cache honours the same expiry. After expiry, free limits apply again. Existing cards, wanted entries, binders and queued edits are retained; further growth above the free allowance needs Premium. Partner access follows the owner's plan, so it ends when the owner's trial expires unless paid or lifetime access applies.

Apply `scripts/056_signup_premium_trial.sql` before deploying the updated app. Before application, the app tolerates the missing trial field and uses the existing free/paid/lifetime rules; older clients keep their conservative client gates until updated. Rollback restores `billing_has_paid` from 049 and `get_billing_access` from 052 without deleting user data. Verify with `TRIAL_TEST_DATABASE_URL=… bun scripts/verify-premium-trial.ts --hosted-rollback`; all synthetic fixtures and both migration runs roll back.

## Pricing cutover, 8 November 2026

The live Stripe audit found no Holo Folder subscriptions or open Checkout sessions before preparing the increase. The existing account `acct_1AHHDjGnHtZtNtvx` and product `prod_VaRpQ69dXzmuF8` are reused. New immutable recurring GBP prices were created with distinct v2 lookup keys. Existing v1 prices, portal configuration `bpc_1UZGvdGnHtZtNtvxOpUSMTxK` and webhook `we_1UZGveGnHtZtNtvxZZuWLWk7` are retained. No charge, subscription migration or unrelated product change is part of the cutover.

| Configuration | Monthly | Annual |
| --- | --- | --- |
| New-sale price ID | `price_1UZVG6GnHtZtNtvxLBCYu6FU` | `price_1UZVG6GnHtZtNtvxKtPxXAFj` |
| New amount in pence | 399 | 3499 |
| New lookup key | `holofolder_gbp_month_v2` | `holofolder_gbp_year_v2` |
| Previous price ID | `price_1UZGvdGnHtZtNtvxWwoxG6ue` | `price_1UZGvdGnHtZtNtvxXO2YEEDd` |
| Previous amount in pence | 299 | 2999 |

`STRIPE_MONTHLY_PRICE_ID` and `STRIPE_YEARLY_PRICE_ID` select new sales. `STRIPE_LEGACY_PRICE_IDS` must contain `price_1UZGvdGnHtZtNtvxWwoxG6ue,price_1UZGvdGnHtZtNtvxXO2YEEDd` when switching to v2. Reconciliation, paid-time recognition and collector payment history recognize both sets; new Checkout only selects the configured current price. This does not add a general grandfathering product. Genuine already-paid old-price access remains recognized, and lifetime access still bypasses Checkout.

Before creating or reusing Checkout, the server retrieves the expanded price/product and verifies active Holo Folder metadata, GBP amount, recurrence/interval count and single licensed per-unit pricing against shared constants. A mismatched configuration fails closed. Session reuse checks actual line items, owner/client reference, interval and mode. A same-interval session with the old price is expired rather than reused; duplicate matching sessions are expired. Sessions tagged for another app are untouched.

Coordinate the release in this order:

1. Prepare the new price objects and pricing PR, run focused checks and wait for exact-head Typecheck/Vercel. Do not change Production IDs yet: another unrelated main deployment could otherwise activate them before the matching app/marketing release.
2. From a separate Framer branch off main, update the published allowance, sharing/import and pricing offers, Terms and the collector privacy notice. Preserve the existing `expand-site-content` branch. Publish the branch preview, inspect it, merge that branch to main, and publish production. Confirm the new £3.99/£34.99 copy and privacy notice are live before the higher Checkout price is activated. A short period where Checkout still costs less than the new offer is preferable to a lower offer leading to a higher charge.
3. Stage the new IDs and the legacy allowlist in Vercel Production. After the privacy notice is live, `HOLOFOLDER_FUNNEL_ENABLED=true` can be staged for the same deployment. Environment changes affect a new deployment, not the currently running one. Merge the pricing PR immediately after checking the current head and every required check/review. Verify its exact production deployment and the live app/Framer/Stripe amounts. Keep previews/test verification in test mode.
4. Inspect open Holo Folder sessions again at cutover. Expire any remaining old-price sessions only after verifying their Holo Folder metadata/product and line items. New requests also reject stale sessions automatically. Verify tracking enablement separately with `docs/collector-funnel.md`; never fabricate paid events or make a real test charge.

At PR preparation, only the new Stripe price objects exist: Production IDs, live app price and published Framer offer still use v1. The final merge/publish/configuration verification must be recorded before calling the rollout complete.

Rollback requires coordinated external changes. Restore the v1 monthly/yearly IDs, revert app display/validation and restore the corresponding Framer price copy together, inspecting/expiring only abandoned v2 Holo Folder Checkout sessions. Put both v1 and v2 IDs in the legacy-recognition allowlist so any genuinely paid subscription retains access. A Git revert alone does not change Stripe objects, Vercel environment snapshots or Framer publication. Leave prices/data intact; no deletion or immutable price mutation is required. Funnel enablement has its own flag and privacy/retention handling.

If a v2 subscription has already been paid, retain the combined-price recognition helper and its reconciliation/history calls when rolling back the sale price. The pre-PR code does not read the legacy allowlist; blindly reverting those calls would stop recognizing v2 paid access. Before any v2 payment, a full code revert plus the matching v1 configuration/Framer copy is sufficient.

## Free read-only sharing

After migration `053_free_binder_sharing.sql` and its app release, signed-in owners can create, copy, disable and re-enable their existing named or token share links without a subscription. Enabled links remain viewable after subscription expiry. Owner-only RLS, origin checks, explicit link enablement, private response headers, noindex metadata and public-field filtering are retained. Partner editing and sold comparisons remain paid. Price visibility and existing share appearance are unchanged.

Apply 053 before releasing the app: it removes only `billing_share_insert` and `billing_share_update`, leaving the four owner policies intact. The older deployed app still has its paid create/render guards until updated. Verify with `FREE_SHARING_TEST_DATABASE_URL=postgresql://... bun scripts/verify-free-sharing.ts --hosted-rollback`; all changes and synthetic fixtures are rolled back. This checks double application, owner creation/re-enable/disable, stranger/anonymous denial, the unchanged paid-partner boundary and data-preserving rollback, including a rolled-back EXPLAIN ANALYZE under owner RLS.

Applied 053 to the existing hosted Supabase target on 8 November 2026 after the rollback-only verification passed. Verified both paid-share policies were removed, all four owner policies and partner/invite policies were unchanged, and every existing share record was retained. App rollout is tracked by the #304 PR.

For rollback, revert the app PR and restore these two policies as the trusted operator, retaining every existing token and share row:

```sql
DROP POLICY IF EXISTS billing_share_insert ON public.binder_shares;
CREATE POLICY billing_share_insert ON public.binder_shares AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.billing_enforced() OR public.billing_has_paid(owner_user_id));
DROP POLICY IF EXISTS billing_share_update ON public.binder_shares;
CREATE POLICY billing_share_update ON public.binder_shares AS RESTRICTIVE FOR UPDATE TO authenticated
  WITH CHECK (NOT is_enabled OR NOT public.billing_enforced() OR public.billing_has_paid(owner_user_id));
```

## Free-plan allowance rollout and rollback

Migration `052_free_plan_allowances.sql` adds server-owned `free_card_limit` and `free_binder_limit` values to the existing configuration. It preserves the billing enforcement switch, original grandfather cutoff and licences. The billing RPC returns these values, and clients retain them in their account/owner-scoped offline cache. Before migration, updated signed-in clients conservatively keep the old ten-entry/20-binder policy; guests can save 100 entries locally. Existing cards, queued edits and extra binders are never deleted or hidden by the new limits. Non-growing edits and deletion remain available above the allowance.

The collection and binder database triggers serialize checks per owner, including direct database writes and concurrent requests. The binder API prechecks the same allowance for a useful HTTP 402; the database remains authoritative for races. Creating the first named binder does not create an extra default binder first. Existing default-binder initialization remains idempotent.

1. Run the local concurrency verifier on a disposable database: `FREE_PLAN_TEST_DATABASE_URL=postgresql://.../holofolder_free_plan bun scripts/verify-free-plan.ts`. It creates the synthetic billing schema, applies 049 and 052, checks 052 twice, then verifies concurrent collection/binder limits and data-preserving rollback. The local database must be fresh; never point the local mode at the hosted database.
2. Inspect the hosted target and verify `FREE_PLAN_TEST_DATABASE_URL` explicitly with `bun scripts/verify-free-plan.ts --hosted-rollback`. This applies 052 twice and checks synthetic owner/permission/cap/rollback behaviour inside one transaction, then rolls everything back. It does not change the existing cutoff, enforcement or licence grants.
3. Apply 052 to the hosted target before releasing the new app. Older deployed clients may still guard at ten until their app updates. Verify the two configuration values and the new trigger/RPC. Keep the existing enforcement value.
4. Release the code and verify its exact production deployment. Confirm account usage and the binder switcher reflect the server values. Billing prices, sharing and paid partner/comparison rules are unchanged in this release.

To reverse the product policy without removing any saved data or schema, run this as the trusted operator, then revert the app PR if needed:

```sql
UPDATE public.billing_configuration
SET free_card_limit = 10, free_binder_limit = 20
WHERE id;
```

Refresh billing on connected clients; offline clients retain their last-known limits until reconnecting, and server-rejected edits remain queued. Updated clients consume the restored values. The additive columns and trigger can remain; the trigger's 20-binder safety ceiling and owner-immutability check remain active. No row deletion is part of rollback. Reapplying 052 preserves the configured values, so deliberately restoring the new policy requires setting them back to 100 and 1.

Applied 052 to the existing hosted Supabase target on 8 November 2026 after rollback-only verification. Verified limits 100/1 and the binder trigger; enforcement stayed enabled, the original cutoff stayed unchanged, and both perpetual grants were preserved. Local real-Postgres concurrency and rollback checks passed. Production app deployment is tracked by the #303 PR.

## Permanent licences

Migration `049_billing_access.sql` records the original UTC grandfather cutoff and grants all earlier Supabase accounts perpetual access. A rerun preserves the cutoff. The licence applies to the whole account, including future binders; no Stripe customer or subscription is necessary. It cannot be granted or edited by authenticated clients. Lifetime users see “Lifetime access” instead of a checkout offer.

Grant a licence later using a trusted database connection and a verified account UUID:

```sql
INSERT INTO public.perpetual_licences(owner_user_id, source)
VALUES ('<verified auth.users UUID>', 'manual') ON CONFLICT DO NOTHING;
```

Anonymous device-only binders cannot establish an account licence. Preserve their data and handle any grandfathering exception manually after account creation.

## Setup and rollout

1. Apply migration 049 with enforcement off, after inspecting the target schema. Check `billing_configuration.grandfather_cutoff` and verify every account before it has a licence.
2. Run `bun scripts/setup-stripe-billing.ts` with your Stripe test key, `STRIPE_SETUP_ACCOUNT_ID` and an HTTPS `STRIPE_SETUP_WEBHOOK_URL` for a read-only inventory. The script checks the key-owning account against the expected ID before listing or creating resources. `--apply` creates missing Holo Folder resources only. Set `STRIPE_CONFIG_OUTPUT` to a new private file outside the repository to receive a newly created webhook secret. The script does not print secrets.
3. Put the returned price IDs, portal configuration ID and webhook secret into the Vercel project's production environment. Keep development/preview payment verification in test mode. The Stripe integration supplies the existing account keys. Never create a real charge for an integration test.
4. Deploy billing-aware code and verify signed webhook handling before enabling enforcement. Set `NEXT_PUBLIC_SITE_URL` to your public app URL; Checkout and portal returns use that origin at `/app?billing=return`. The hosted app uses `https://holofolder.com/app?billing=return`; its webhooks use the Vercel origin at `/app/api/billing/webhook` so no Framer body transformations interfere with signatures.
5. Enable with `UPDATE public.billing_configuration SET enforced=true WHERE id;`. Confirm old accounts and their partners remain unlocked, a new account is free, and comps/card writes enforce access. Read-only sharing is free after 053. The staged switch is server-owned and initially off.

Before the migration exists, billing actions are unavailable and the old application remains usable. A subscription's verified paid-through date determines access; an unpaid renewal cannot extend it. A perpetual licence always takes precedence. Cancellation through the portal is at period end. The app retains cards, partnership and share records after expiry. Billing responses are private and never cached by the service worker.

## Verification

`bun run test`, `bun run typecheck`, `bun run lint`, `bun run build` are the release checks for this change. Cal explicitly excluded e2e verification. The earlier targeted browser attempt did not pass; it showed signed-out fixture state rather than the intended signed-in flow, and a card-control selector timed out. No passing browser/PWA proof is claimed. `scripts/verify-billing.ts` requires `BILLING_TEST_DATABASE_URL`; all migration changes, licences, account fixtures and enforcement changes are rolled back on the hosted target. It never defaults to production credentials. For true concurrent cap testing use the isolated local database test, not synthetic users committed to production.

An HTTP 402 pauses collection sync with the edited item and operation retained on the device. A later entitlement or usage refresh retries the operation when the account changes. A new edit/removal and visibility/reconnect refresh usage; ordinary permanent 4xx errors retain their existing rollback behavior.

Only mapped Holo Folder Stripe customers and allowlisted prices affect access. Signed webhooks reconcile authoritative subscription and paid invoice state under a per-owner lease, commit the access state and event receipt together, and retry on lock/network/database errors. Unrelated Syncaura events are acknowledged without modifying Holo Folder access. Never change account-wide branding, unrelated products or the default customer portal configuration.

## Initial configuration, 7 November 2026

Migration 049 was applied with enforcement off. Grandfather cutoff `2026-11-07T21:13:57.946Z`: two eligible auth accounts, two perpetual grants, verified. Monthly/yearly price IDs, app-specific portal configuration and webhook secret are configured in Vercel production. Local checks: 1004 unit tests, full typecheck and the existing 64-warning lint cap. No real payment was submitted. Enforcement remains off until the merged production build and a signed webhook request are verified.

The unmerged billing file was renumbered from 047 to 049 after parallel account-identity releases allocated 047 and 048. Its SQL content was unchanged and reapplication verified the original cutoff and both grants. Both named and legacy share routes originally used the same premium access check; 053 and its app release remove that requirement.

Framer Home pricing, Terms and Privacy drafts now describe these plans, lifetime access and Stripe processing. Draft screenshots were visually reviewed at desktop, tablet and phone sizes. Publishing requires the Framer project’s explicit publish authorization.
