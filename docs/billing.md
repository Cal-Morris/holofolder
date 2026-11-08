# Billing and lifetime access

Holo Folder uses its own product, recurring GBP prices, customers and portal configuration in the existing Syncaura Stripe account. It does not use Stripe Connect. The plans are £2.99/month and £29.99/year. After migration 052, the free allowance is 100 saved entries across all binders, including individual wanted cards, and one binder. One owner's paid access includes their shared partner collection. Paid/lifetime owners can create multiple binders within the existing 20-binder safety ceiling.

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
2. Run `bun scripts/setup-stripe-billing.ts` with the Syncaura key for a read-only inventory. `--apply` creates missing Holo Folder resources only. Set `STRIPE_CONFIG_OUTPUT` to a new private file outside the repository to receive a newly created webhook secret. The script does not print secrets.
3. Put the returned price IDs, portal configuration ID and webhook secret into the Vercel project's production environment. Keep development/preview payment verification in test mode. The Stripe integration supplies the existing account keys. Never create a real charge for an integration test.
4. Deploy billing-aware code and verify signed webhook handling before enabling enforcement. Public return URLs are `https://holofolder.com/app?billing=return`; webhooks use the Vercel origin at `/app/api/billing/webhook` so no Framer body transformations interfere with signatures.
5. Enable with `UPDATE public.billing_configuration SET enforced=true WHERE id;`. Confirm old accounts and their partners remain unlocked, a new account is free, and shares/comps/card writes enforce access. The staged switch is server-owned and initially off.

Before the migration exists, billing actions are unavailable and the old application remains usable. A subscription's verified paid-through date determines access; an unpaid renewal cannot extend it. A perpetual licence always takes precedence. Cancellation through the portal is at period end. The app retains cards, partnership and share records after expiry. Billing responses are private and never cached by the service worker.

## Verification

`bun run test`, `bun run typecheck`, `bun run lint`, `bun run build` are the release checks for this change. Cal explicitly excluded e2e verification. The earlier targeted browser attempt did not pass; it showed signed-out fixture state rather than the intended signed-in flow, and a card-control selector timed out. No passing browser/PWA proof is claimed. `scripts/verify-billing.ts` requires `BILLING_TEST_DATABASE_URL`; all migration changes, licences, account fixtures and enforcement changes are rolled back on the hosted target. It never defaults to production credentials. For true concurrent cap testing use the isolated local database test, not synthetic users committed to production.

An HTTP 402 pauses collection sync with the edited item and operation retained on the device. A later entitlement or usage refresh retries the operation when the account changes. A new edit/removal and visibility/reconnect refresh usage; ordinary permanent 4xx errors retain their existing rollback behavior.

Only mapped Holo Folder Stripe customers and allowlisted prices affect access. Signed webhooks reconcile authoritative subscription and paid invoice state under a per-owner lease, commit the access state and event receipt together, and retry on lock/network/database errors. Unrelated Syncaura events are acknowledged without modifying Holo Folder access. Never change account-wide branding, unrelated products or the default customer portal configuration.

## Initial configuration, 7 November 2026

Migration 049 was applied with enforcement off. Grandfather cutoff `2026-11-07T21:13:57.946Z`: two eligible auth accounts, two perpetual grants, verified. Monthly/yearly price IDs, app-specific portal configuration and webhook secret are configured in Vercel production. Local checks: 1004 unit tests, full typecheck and the existing 64-warning lint cap. No real payment was submitted. Enforcement remains off until the merged production build and a signed webhook request are verified.

The unmerged billing file was renumbered from 047 to 049 after parallel account-identity releases allocated 047 and 048. Its SQL content was unchanged and reapplication verified the original cutoff and both grants. Both named and legacy share routes use the same premium access check.

Framer Home pricing, Terms and Privacy drafts now describe these plans, lifetime access and Stripe processing. Draft screenshots were visually reviewed at desktop, tablet and phone sizes. Publishing requires the Framer project’s explicit publish authorization.
