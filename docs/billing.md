# Billing and lifetime access

Holo Folder uses its own product, recurring GBP prices, customers and portal configuration in the existing Syncaura Stripe account. It does not use Stripe Connect. The plans are £3.99/month and £34.99/year, saving £12.89 against twelve monthly payments, plus a one-time £79 Lifetime licence (see Lifetime purchase). After migration 052, the free allowance was 100 saved entries across all binders, including individual wanted cards, and one binder. Migration 129 makes saved entries unlimited on the free plan by setting `free_card_limit` to the largest integer, which `UNLIMITED_FREE_CARD_LIMIT` in `lib/billing.ts` reads as no cap; the enforcement triggers are unchanged and the one-binder limit stays. Premium features and extra binders do the converting. One owner's paid access includes their shared partner collection; billing is per owner, never per binder or per person. Paid/lifetime owners can create multiple binders within the existing 20-binder safety ceiling.

## Free and Premium features

The free plan covers the everyday binder: one binder from any preset, the wanted list, a read-only share link, card and whole-page binder scanning, offline use and one current price per card, including the basic Show mode price lookup. Premium adds extra binders, custom page sizes, Partner mode, eBay listings and sold comps, multi-source price comparison, bundle pricing and the developer API and MCP server. It also covers the price history, Cardmarket trend chart, timing signals and Rising and Breakout highlights, the Analytics view (including its CSV export), the Show mode deal verdict, pay-up-to prices, show budget and purchase tally, and the Hunting list's sort, filters and Good pickups. Only a loaded free plan locks these views (`hasPremiumFeatures` in `lib/billing.ts`). Signed-out guests keep the full demo because every new account starts on the Premium trial, and paid owners see no upsell flash while billing loads. The gates are client-side in the components that compute these views, with `components/premium-upsell.tsx` holding the shared upsell card and `usePremium`. The price history rides on the public `/api/card-prices` route, so it has no separate server gate.

## Automatic Premium trial

Migration 056 grants full Premium automatically for 168 hours from the collection owner's `auth.users.created_at`, including their partner. Accounts already less than seven days old get the remaining time, not a fresh trial at deployment. Lifetime licences and active paid subscriptions take precedence. The trial creates no Stripe customer or subscription, needs no payment details and never converts into a charge. Choosing a monthly or annual purchase still opens the existing paid Checkout.

The database uses the trusted signup timestamp for premium checks and returns the expiry to the app. Settings shows the trial terms and local expiry time; the scoped offline billing cache honours the same expiry. After expiry, free limits apply again. Existing cards, wanted entries, binders and queued edits are retained; further growth above the free allowance needs Premium. Partner access follows the owner's plan, so it ends when the owner's trial expires unless paid or lifetime access applies.

Apply `scripts/056_signup_premium_trial.sql` before deploying the updated app. Before application, the app tolerates the missing trial field and uses the existing free/paid/lifetime rules; older clients keep their conservative client gates until updated. Rollback restores `billing_has_paid` from 049 and `get_billing_access` from 052 without deleting user data.

## Trial-ending email

A daily cron (`vercel.json`, 10:00 UTC, `GET /app/api/trial-ending-emails` with `Authorization: Bearer $CRON_SECRET`) sends one plain-text service email through Resend (the provider already behind Supabase Auth SMTP on `mail.holofolder.com`) to owners whose trial ends 40 to 64 hours later, so each owner falls in exactly one run, around day 5. It says when the trial ends, what stays free, what Premium adds, the plans and the invite reward. `selectTrialEmailRecipients` in `lib/trial-ending-email.ts` skips unconfirmed emails, partner members (partners follow the owner's plan), lifetime owners, owners with paid time or an invite grant past the trial end, and anyone already emailed. Migration `135_trial_ending_emails.sql` holds the claim row, inserted before sending and removed again if the send fails; Resend's idempotency key (`trial-ending/<owner>`) covers a retried run.

The cron does nothing until `RESEND_API_KEY` is set. With `TRIAL_EMAIL_TEST_TO` set it sends one sample to that address and records nothing, so remove that variable to go live. `TRIAL_EMAIL_FROM` overrides the sender. The lifetime price is mentioned only when `STRIPE_LIFETIME_PRICE_ID` is set.

## Invite a friend

Migration `133_premium_grants_and_referrals.sql` adds server-owned Premium time on top of the existing model, with no Stripe changes. Each owner gets a stable invite link in Settings → Plan (`https://holofolder.com/app/invite/<code>`, code from `referral_code_v1`). When a genuinely new account made through that link reaches 10 saved entries (the funnel's activation milestone), both the invitee and the inviter get 30 days of Premium.

A grant is a `premium_grants` row (owner, `starts_at`, `ends_at`, reason `referral_inviter` or `referral_invitee`, source referral). `billing_has_paid` counts a grant that has started and not ended, and `get_billing_access` returns `granted_until` (end of the owner's grant chain) and `referral_pending`. In the app the order is lifetime, active subscription, trial, then grant (`resolveBillingAccess` in `lib/billing.ts`), and the offline billing cache re-resolves the same expiry. Each new grant starts at the latest of now, the owner's 7-day trial end and their last grant end, so time stacks without overlap and an invitee's month follows their trial. Grants never create Stripe customers, subscriptions or charges, and lapse to free on their own, exactly like the trial. An inviter can earn at most 12 rewards (360 days) ever; invitees past that cap still get their own month. Partner access follows the owner's plan, so a grant on the owner covers their partner.

The flow, all server-side:

1. `GET /app/invite/<code>` sets an httpOnly cookie `hf_invite` holding the code and the server's click time, signed with HMAC-SHA256 (keyed on the service role key, like the developer rate limiter), for 30 days, then redirects into the app. A second invite link does not replace a pending click (first touch).
2. The owner's own `GET /app/api/billing`, which every signed-in app open makes, verifies the cookie and calls `attribute_referral_v1`. The database rejects unknown codes, self-invites, partners of the inviter and accounts created before the click or more than 7 days ago; `referrals.invitee_user_id` is unique, so an account is attributed once. The cookie is cleared after any definite answer.
3. While `referral_pending` is true and the server-persisted saved count reaches 10, the same billing read calls `claim_referral_reward_v1`. It locks the referral, re-checks the count and the partner rule, adds both grants (serialised per owner with an advisory lock) and marks the referral rewarded once.

`GET /app/api/referrals` returns the signed-in account's link and rewarded/pending counts for Settings. RLS lets owners read only their own codes, referrals and grants; there are no client write policies, and the functions are service-role only. Invites are website-only, like the rest of billing (see `docs/public-api/coverage.md`).

| Abuse case                          | Handling                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Self-referral with the same account | `attribute_referral_v1` returns `self`, and a CHECK forbids inviter = invitee.                                                                                                                                                                                                 |
| Self-referral with a second email   | The second account must be created after the signed click, reach 10 server-saved entries in its own collection, and the inviter is capped at 12 rewards ever. That makes farming slow and bounded; it is not impossible.                                                       |
| Partner accounts                    | A partner (either direction) of the inviter can't be attributed or rewarded; checked at attribution and again at reward. A partner editing the owner's binder adds to the owner's count, not their own, so they don't activate. Settings shows the invite link only to owners. |
| Existing accounts                   | Accounts created before the click, or more than 7 days old, are `not_new`. The click time comes from the signed cookie, so it can't be backdated.                                                                                                                              |
| Deleted accounts                    | Deleting either account cascades its code, referrals and own grants. Time the other side already earned stays (the grant's referral link is set null). A deleted and re-created email is a new account, covered by the second-email row.                                       |
| Offline queued saves                | Only entries persisted on the server count (`slot_saved_count_v1`); queued edits count once they sync and the next billing read rewards.                                                                                                                                       |
| Trial overlap                       | The invitee's month starts when their 7-day trial ends, and any grant stacks after existing grants, so no time is lost to overlap. Lifetime and active subscriptions still take precedence; grant time running alongside a subscription is not paused.                         |
| Replays and races                   | One referral per invitee (unique), one grant per side per referral (unique), row lock on claim and a per-owner advisory lock when adding grants.                                                                                                                               |

Before 133 is applied, `get_billing_access` has no grant fields, the invite route still sets its cookie, attribution and claims are no-ops, and Settings shows "Invites are not available yet". Verify with `REFERRAL_REWARDS_TEST_DATABASE_URL=postgresql://... bun scripts/verify-referral-rewards.ts --hosted-rollback`, which applies 133 twice inside a rolled-back transaction and checks every rule above, the cap, RLS, function privileges, deletion and an EXPLAIN ANALYZE of `get_billing_access`. Rollback: restore `billing_has_paid` and `get_billing_access` from 056 (grants then stop counting) and revert the app; the tables can stay.

## Commission programme

Cal approved a commission programme on 15 November 2026. People Cal enrols as affiliates (creators with an audience promotion code, and anyone else he enrols as a partner) earn cash: 30% of each payment from a customer they brought in, for that customer's first 12 months of subscription payments, and 30% of a lifetime purchase. Ordinary users are not affiliates and keep the free-month invite reward above; an affiliate keeps it too, since that rewards activation, not payment. Commission is on what the customer actually paid in GBP after discounts and refunds (Stripe's `amount_paid` and `amount_total`, before Stripe fees), so it works unchanged with launch discounts, a free audience month earns nothing and a £0 creator lifetime code earns nothing. No money moves automatically: Cal pays out by hand and marks entries paid.

Migration `140_commission_programme.sql` adds three service-role-written tables:

- `affiliates`: owner, display name, private payout email (no client role can read that column), optional `stripe_promotion_code_id` and code text, and `active`. Pausing stops new customers and new earnings; the ledger stays.
- `affiliate_customers`: one row per customer, primary key on the customer, so a customer has at most one affiliate, ever. No client access; the app shows only a count.
- `commission_entries`: the ledger. Earnings are keyed on the Stripe invoice id or lifetime Checkout session id (unique), with the PaymentIntent the refunds point back to. Adjustments are rows linked to their earning. Affiliates can read their own entries, without customer or Stripe ids.

Attribution is decided once, when a Holo Folder Checkout completes (`attributeCheckout` in `lib/server/commissions.ts`, rules in `chooseAffiliate` in `lib/commissions.ts`). The first subscription invoice can arrive before `checkout.session.completed`, so `invoice.paid` for a `subscription_create` invoice runs the same attribution from that subscription's Checkout first. Candidates are the active affiliate whose invite link made the account (first touch, so it wins) and the active affiliate who owns the promotion code used at Checkout. A candidate is skipped if they are the customer, a partner of the customer, share the Stripe customer, or share any email (account, payout or Checkout email, compared lower case without a `+tag`). Nobody is attributed if the Stripe customer already had a succeeded charge before this Checkout. Ordinary sign-ups cost no extra reads: without an affiliate involved, attribution stops after one lookup.

The ledger is written only from signed webhooks, always before the event receipt is committed so a failure is retried by Stripe:

- `invoice.paid`: an attributed customer's paid invoice on a recognised Holo Folder price, in GBP, paid within 12 months of attribution, earns `floor(amount_paid × 30%)`.
- `checkout.session.completed` (and `async_payment_succeeded`) for lifetime: after the existing lifetime verification, a positive amount earns 30%, recorded before the licence grant.
- `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`: the charge and its disputes are read fresh from Stripe and `commission_adjust_v1` moves the earning to 30% of what is still paid (nothing while a dispute holds the money, the refunded remainder after a won one). It locks the earning row, so concurrent events can't both take money back, and the event id makes a replay a no-op. The target is absolute, so events in any order converge.

Earnings are pending for 30 days after the payment, then payable, then paid when Cal marks them. Payable is derived from `hold_until`, so there is no cron. Adjustments share their earning's hold, so a refund inside the hold cancels out before anything is payable; a refund after payout is a negative entry deducted from the next payout. When an affiliate's payable total is zero or negative, nothing is paid and the balance carries forward.

Settings → Plan shows an Earnings section above the invite link to enrolled affiliates only (`GET /app/api/referrals` returns `earnings` for them, null for everyone else): their code, how many customers they brought in, and pending, ready-to-pay and paid totals. It shows no customer names, emails or ids. Earnings are website-only like the rest of billing (see `docs/public-api/coverage.md`): they are account money, not collection data, so the developer API and MCP server do not expose them.

Operator commands (service role in `.env.local`; dry run until `--apply`):

```sh
bun run commissions --enrol --owner=<uuid> --name="Ash" --payout-email=<email> --promo=<promo_id> --apply
bun run commissions --pause --owner=<uuid> --apply
bun run commissions --month=2026-12
bun run commissions --mark-paid=<entry id>,<entry id> --apply
```

The report pages past the 1,000-row cap and lists, per affiliate, what is payable by the end of that month (including earlier unpaid balances) and still on hold, with the exact `--mark-paid` command. `--mark-paid` only changes entries that are pending and past their hold. Payout steps live in the private runbook `marketing/private/creator-codes.md`. The Stripe webhook endpoint must have the three charge events enabled (`scripts/setup-stripe-billing.ts` lists them for new endpoints).

| Abuse case                                                                      | Handling                                                                                                                                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Affiliate buys through their own code or link                                   | Same owner is rejected, and the CHECK on `affiliate_customers` forbids it.                                                                                            |
| Second account with the affiliate's email, a `+tag` alias or their payout email | Emails are compared lower case without the tag, across account, payout and Checkout emails.                                                                           |
| Second account paying with the affiliate's Stripe customer                      | Rejected when the Stripe customer matches. A brand-new email and card is not detectable; that is ordinary fraud, bounded by the 30-day hold and manual payout review. |
| Partner of the affiliate                                                        | Partners (either direction) are never attributed.                                                                                                                     |
| Two affiliates claim one customer                                               | One row per customer; the invite link (the earlier touch) wins, otherwise the code. Racing events hit the primary key.                                                |
| Existing paying customer types a creator code later                             | No attribution if the Stripe customer had a succeeded charge before the Checkout. Codes only work on new monthly or lifetime Checkouts anyway.                        |
| Pay, collect commission, refund or dispute                                      | The 30-day hold nets refunds out first; later refunds and disputes create negative entries deducted from the next payout.                                             |
| Replayed or out-of-order webhooks                                               | Earnings are unique per invoice or session, adjustments per event, and adjustments target an absolute amount from fresh Stripe state.                                 |
| Forged writes from the app                                                      | No client role can insert, update or call the functions; only verified webhooks and the operator script write.                                                        |
| £0 orders (free audience month, creator lifetime code)                          | Earn nothing: commission is on the amount actually paid.                                                                                                              |
| Leaking customers to the affiliate                                              | The affiliate sees only a count and totals; customer ids, Stripe ids and payout emails are not readable by client roles.                                              |

Before 140 is applied every commission step is a no-op and webhooks behave as before; Settings shows no Earnings. Verify with `COMMISSIONS_TEST_DATABASE_URL=postgresql://... bun scripts/verify-commissions.ts --hosted-rollback`, which applies 140 twice inside a rolled-back transaction and checks first touch, the self CHECK, idempotent earnings, refund and dispute convergence, the shared hold, RLS and column privileges, deletion and an EXPLAIN ANALYZE of the Earnings read. Rollback: revert the app; the tables can stay, and nothing reads them without the app.

## Pricing cutover, 8 November 2026

The live Stripe audit found no Holo Folder subscriptions or open Checkout sessions before preparing the increase. The existing account `acct_1AHHDjGnHtZtNtvx` and product `prod_VaRpQ69dXzmuF8` are reused. New immutable recurring GBP prices were created with distinct v2 lookup keys. Existing v1 prices, portal configuration `bpc_1UZGvdGnHtZtNtvxOpUSMTxK` and webhook `we_1UZGveGnHtZtNtvxZZuWLWk7` are retained. No charge, subscription migration or unrelated product change is part of the cutover.

| Configuration            | Monthly                          | Annual                           |
| ------------------------ | -------------------------------- | -------------------------------- |
| New-sale price ID        | `price_1UZVG6GnHtZtNtvxLBCYu6FU` | `price_1UZVG6GnHtZtNtvxKtPxXAFj` |
| New amount in pence      | 399                              | 3499                             |
| New lookup key           | `holofolder_gbp_month_v2`        | `holofolder_gbp_year_v2`         |
| Previous price ID        | `price_1UZGvdGnHtZtNtvxWwoxG6ue` | `price_1UZGvdGnHtZtNtvxXO2YEEDd` |
| Previous amount in pence | 299                              | 2999                             |

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

## Lifetime purchase, 14 November 2026

Cal approved a one-time Lifetime offer at £79 on 14 November 2026. It is a new offer next to monthly and annual; the £3.99/month and £34.99/year prices are unchanged. Settings shows "£79.00 once, lifetime access" as a third button in the existing plan picker, only when `STRIPE_LIFETIME_PRICE_ID` is set, so the option stays hidden until the offer is switched on. Owners who already have lifetime never see it, and checkout refuses them server-side. Active subscribers can buy it; the app tells them that buying lifetime does not cancel the subscription and that they should cancel it in Manage billing. Nothing is cancelled automatically.

Lifetime has its own Stripe product, because coupons can only be limited by product and not by price. Keeping it separate means a creator's lifetime code can never take money off a subscription and an audience code can never make lifetime free.

| Object                    | ID                               | Details                                                                                                                |
| ------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Product                   | `prod_Vd3NYNGWZvg1v7`            | "Holo Folder Lifetime", metadata `app=holofolder`, `plan=lifetime`                                                     |
| Price                     | `price_1UbnGbGnHtZtNtvxlBrhBnu0` | One-time, 7900 pence GBP, lookup key `holofolder_gbp_lifetime_v1`, metadata `app=holofolder`, `plan=lifetime`          |
| Coupon "Creator lifetime" | `holofolder-creator-lifetime`    | 100% off, once, applies only to the Lifetime product. Per-creator codes are single use (`max_redemptions` 1)           |
| Coupon "Creator audience" | `holofolder-creator-audience`    | 100% off for one month (repeating, 1 month), applies only to the Premium product. Codes are unlimited, first-time only |

The audience coupon technically applies to annual as well, since monthly and annual share the Premium product. The app only enables the promotion code field on monthly and lifetime Checkouts, and the portal configuration does not allow plan switching, so an audience code cannot reach the annual price. Re-check both of those before enabling codes on annual or turning on plan switching in the portal. Vend codes with `bun run promo-code` (a dry run until `--apply`; it checks the key is for the Holo Folder account first). Plans are `lifetime` and `monthly` only, because annual Checkout has no code box. A 100% lifetime offer reuses `holofolder-creator-lifetime`, a 100%-for-one-month monthly offer reuses `holofolder-creator-audience`, and any other discount gets one coupon per plan and discount (`holofolder-<plan>-<discount>-<length>`), scoped to that plan's product.

```sh
bun run promo-code --plan lifetime --code ASH-LIFETIME --percent 100 --max-uses 1 --creator ash --apply
bun run promo-code --plan monthly --code ASH --percent 100 --duration repeating --months 1 --first-time --creator ash --apply
bun run promo-code --plan monthly --code SHOW-HALF --percent 50 --duration repeating --months 3 --max-uses 50 --expires 2027-01-31 --apply
bun run promo-code --list
bun run promo-code --deactivate ASH --apply
```

Commission is tracked by the commission programme below; payout steps are in the private runbook `marketing/private/creator-codes.md`.

Checkout runs in payment mode with `allow_promotion_codes`. Before creating or reusing a session the server retrieves the expanded price and product and checks the one-time GBP amount, per-unit pricing and the `app`/`plan` metadata on both against `BILLING_LIFETIME_PRICE`; a mismatch fails closed. Open sessions are reused or expired with the same rules as subscriptions. Stripe documents that a one-time Checkout brought to £0 by a 100% coupon or promotion code completes without collecting a payment method (`payment_method_collection` becomes `if_required`) and has no PaymentIntent, so fulfilment listens for `checkout.session.completed` (and `checkout.session.async_payment_succeeded` for delayed methods), not PaymentIntent events.

Fulfilment (`lib/billing-lifetime.ts`) retrieves the session with its line items and grants lifetime only when it is a complete payment-mode session tagged for this owner, with a single line of the configured lifetime price at a £79 subtotal, and either `payment_status=paid` with a positive total or a £0 total with a promotion code. A live £0 order completes with `payment_status=paid`, not `no_payment_required` (verified 14 November 2026 with a TEST code), so both statuses are accepted for £0. The grant inserts the owner's `perpetual_licences` row with source `purchase`, the session ID and the promotion code ID, ignoring a conflict, before the event receipt is committed, so a failure is retried by Stripe and a replay is a no-op. An owner who already has a licence is left unchanged. Only a positive amount records the collector `first_paid` milestone; a £0 creator redemption is not revenue. Subscription paid-time and "positive GBP paid invoice" rules are unchanged. If an owner somehow pays twice (two tabs), the second payment grants nothing and needs a manual refund.

Migration `134_lifetime_purchases.sql` adds `stripe_checkout_session_id` (unique) and `stripe_promotion_code_id` to `perpetual_licences` and allows source `purchase`. It was applied to the hosted Supabase project on 14 November 2026 after a rolled-back double application; the four existing licences (two grandfathered, two manual) were kept. Before 134 a lifetime grant fails and Stripe retries the event, so no purchase is lost; the offer stays hidden until the price variable is set anyway.

Switch-on order, matching the cutover above: the price and coupons exist first with the app merged but the option hidden; then the Framer pricing copy is published; then `STRIPE_LIFETIME_PRICE_ID=price_1UbnGbGnHtZtNtvxlBrhBnu0` is staged in Vercel Production and the latest main is deployed and verified. Rollback is removing that variable and redeploying, which hides the option; existing purchased licences stay. Stripe objects can be archived but not deleted once used.

## Launch offer, 15 November to 31 December 2026

Cal approved a launch offer on 15 November 2026: 50% off the first payment period of every plan, ending 31 December 2026. It is an introductory offer, so the normal prices genuinely apply afterwards and the app never shows a "was" price. The wording is the same everywhere: "Launch offer: 50% off, ends 31 December 2026", "Launch offer: £2.00 a month for 3 months, then £3.99 a month", "Launch offer: £17.50 for your first year, then £34.99 a year" and "Launch offer: £39.50 until 31 December, then £79" (`launchOfferText` in `lib/billing.ts`).

`LAUNCH_OFFER` in `lib/billing.ts` holds the end (`2026-12-31T23:59:59` Europe/London, which is GMT that day), the offer prices and the coupon IDs. While `launchOfferActive()` is true, `startCheckout` adds the plan's coupon as `discounts` on the Checkout Session, and Settings → Plan shows the offer wording on the plan buttons. After the end both switch off on their own, with no deploy. Each coupon takes an exact amount off in GBP rather than a percentage, so Checkout charges exactly what the app shows.

| Coupon ID                         | Amount off | Duration            | Applies to       | Charged                          |
| --------------------------------- | ---------- | ------------------- | ---------------- | -------------------------------- |
| `holofolder-launch-2026-month`    | 199 pence  | repeating, 3 months | Premium product  | £2.00 for 3 months, then £3.99   |
| `holofolder-launch-2026-year`     | 1749 pence | once                | Premium product  | £17.50 for year one, then £34.99 |
| `holofolder-launch-2026-lifetime` | 3950 pence | once                | Lifetime product | £39.50 once                      |

Stripe coupons can only be limited by product, not by price, so the monthly and annual coupons are both scoped to the Premium product. That is safe because none of them has a promotion code: only the server attaches them, and it picks the coupon for the plan being bought. Each coupon has `redeem_by` set to 24 hours after the end date as a backstop, because a Checkout opened just before midnight can stay open for up to a day.

Stripe accepts either `discounts` or `allow_promotion_codes` on a session, never both (checked live: it rejects the pair), so a launch coupon and a creator or audience code can never stack. Settings has a "Have a creator code?" button. With it on, monthly and lifetime Checkouts open with the code box and no launch coupon, so the customer's code replaces the offer; annual has no code box and keeps the offer. The session's `offer` metadata records the coupon (or `none`), and an open session is only reused when that matches, so sessions from before the offer, with a code, or after the end are expired instead of reused.

Fulfilment needed no change. A discounted lifetime order completes `paid` with a positive total and is granted like a full-price one; only positive amounts record `first_paid` (lifetime) or count as collector payments (subscriptions), and the 100% creator and audience codes still work as before.

Verified live on 15 November 2026 with Checkout Sessions that had no customer and were expired straight away (no customer, payment method or charge): monthly 399 → 200, annual 3499 → 1750 and lifetime 7900 → 3950 with the launch coupon; with the code box, monthly 399 and lifetime 7900 with no coupon; temporary 100% codes brought monthly and lifetime to 0 and were then deactivated unused. Stripe rejected coupon plus code box together, and each launch coupon on the other product's price.

Clean-up on 1 January 2027: the app switches itself off, but remove the Framer offer copy (pricing page, homepage pricing and the banner) and publish. Later, in a normal PR, delete `LAUNCH_OFFER` and its helpers, UI and tests. The coupons expire through `redeem_by`; subscriptions already on the monthly coupon keep it until their three months end.

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

The rollout verifiers for 052, 056 and the billing caps (`scripts/verify-free-plan.ts`, `verify-premium-trial.ts`, `verify-billing.ts`, `verify-billing-concurrency.ts`) were removed once migration 108 dropped `pokemon_collection`, the table they seeded.

1. Apply 052 to the hosted target before releasing the new app. Older deployed clients may still guard at ten until their app updates. Verify the two configuration values and the new trigger/RPC. Keep the existing enforcement value.
2. Release the code and verify its exact production deployment. Confirm account usage and the binder switcher reflect the server values. Billing prices, sharing and paid partner/comparison rules are unchanged in this release.

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

`bun run test`, `bun run typecheck`, `bun run lint`, `bun run build` are the release checks for this change. Cal explicitly excluded e2e verification. The earlier targeted browser attempt did not pass; it showed signed-out fixture state rather than the intended signed-in flow, and a card-control selector timed out. No passing browser/PWA proof is claimed.

An HTTP 402 pauses collection sync with the edited item and operation retained on the device. A later entitlement or usage refresh retries the operation when the account changes. A new edit/removal and visibility/reconnect refresh usage; ordinary permanent 4xx errors retain their existing rollback behavior.

Only mapped Holo Folder Stripe customers and allowlisted prices affect access. Signed webhooks reconcile authoritative subscription and paid invoice state under a per-owner lease, commit the access state and event receipt together, and retry on lock/network/database errors. Unrelated Syncaura events are acknowledged without modifying Holo Folder access. Never change account-wide branding, unrelated products or the default customer portal configuration.

## Initial configuration, 7 November 2026

Migration 049 was applied with enforcement off. Grandfather cutoff `2026-11-07T21:13:57.946Z`: two eligible auth accounts, two perpetual grants, verified. Monthly/yearly price IDs, app-specific portal configuration and webhook secret are configured in Vercel production. Local checks: 1004 unit tests, full typecheck and the existing 64-warning lint cap. No real payment was submitted. Enforcement remains off until the merged production build and a signed webhook request are verified.

The unmerged billing file was renumbered from 047 to 049 after parallel account-identity releases allocated 047 and 048. Its SQL content was unchanged and reapplication verified the original cutoff and both grants. Both named and legacy share routes originally used the same premium access check; 053 and its app release remove that requirement.

Framer Home pricing, Terms and Privacy drafts now describe these plans, lifetime access and Stripe processing. Draft screenshots were visually reviewed at desktop, tablet and phone sizes. Publishing requires the Framer project’s explicit publish authorization.

## Custom binder layouts

The six existing layouts (1×1, 2×2, 3×3, 3×4, 4×3 and 4×4) stay free. Premium, trial and lifetime accounts can choose any whole-number row and column counts from 1 to 8 in Settings → Binder. Dimensions belong to the open binder and follow the collection owner's access. Existing custom layouts remain readable after expiry; choosing a different custom layout requires Premium again. Shared links and offline copies keep the saved dimensions. Dense pages scroll inside their frame, with pockets at least 64×90 px and page turning through the header arrows.

Migration `057_custom_binder_layouts.sql` widens the binder constraint and enforces the same custom-layout gate on binder, legacy settings and appearance writes. Apply it before deploying the controls; without it, an 8×8 save fails clearly and stays queued on the device.
