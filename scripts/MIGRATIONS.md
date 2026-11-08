# Database migrations

The Supabase schema is defined by the numbered SQL files in this folder. There is no migration runner: apply them by hand (Supabase SQL editor or `psql`) in numeric order. Keep a record of applied files. Older scripts include one-time policy creation and data backfills; do not replay the full sequence against an existing project. Individual scripts document whether they are safe to rerun.

For a fresh project, apply `001`, create the reconstructed `user_settings` table below before `012`, then continue the numbered files in order. Use psql autocommit for `CONCURRENTLY` statements in `034`, `035`, `039` and `051`. Run `048` as one transaction (`psql --single-transaction -f scripts/048_named_share_account_identity.sql`), because it locks the identity tables while reconciling names. The optional `scripts/legacy/034_tcgdex_cache_jobs_index.sql` is only for existing projects with the retired cache-job table; fresh installs skip it.

The fresh-install corrections in `016`, `033` and `036` affect historical source scripts only. Existing projects do not need a new migration and must not replay old backfills or reset policies. No hosted schema change is required.

When you add a migration, use the next free number, keep it idempotent, and add a row below.

| File | What it does |
|---|---|
| `055_share_pricing.sql` | Adds pricing opt-in, defaults existing and new links to off, and returns the preference from the named resolver. Apply before deployment; missing read settings hide prices. |
| `056_signup_premium_trial.sql` | Automatic full Premium for 168 hours from the collection owner's trusted signup time, including partner access. No payment details, Stripe subscription or renewal. Existing paid and lifetime access takes precedence; expiry preserves saved data. Additive access field, older clients remain conservative until updated. |
| `057_custom_binder_layouts.sql` | Allow binder grids through 8×8; enforce premium for new custom dimensions on binders, legacy settings and appearances, retaining saved layouts after expiry. Apply before deploying the custom-layout controls. |
| `054_collector_funnel.sql` | Private first-touch account records and deduplicated best-effort funnel events with auth-user cascades. Service-role-only RPC/read/write access. Telemetry stays disabled until privacy publication and explicit production enablement. Retention/rollback: `docs/collector-funnel.md`. |
| `053_free_binder_sharing.sql` | Makes read-only sharing free by removing only the two paid-share restrictive policies. Owner-only RLS stays intact. Apply before the app release; older code retains its paid gates until updated. Rollback restores the policies without deleting links; see `docs/billing.md`. |
| `052_free_plan_allowances.sql` | Server-owned 100-entry/one-binder free allowance, billing RPC fields and serialized binder-creation enforcement. Preserves enforcement, cutoff, licences and existing over-limit data. Apply before shipping the client; missing columns retain the legacy signed-in policy. Rollback sets limits to 10/20 without deleting data; see `docs/billing.md`. |
| `049_billing_access.sql` | Stripe subscription access, separate permanent licences, fixed grandfather cutoff for existing accounts, staged enforcement, transactional card cap and paid partner/share policies. Apply before enabling billing; enforcement defaults off. |
| `051_comparison_job_initiator.sql` | Completion pushes target the authenticated job initiator. Nullable for old jobs; checks still run before application without completion pushes. Apply the concurrent index separately. |
| `050_comparison_jobs.sql` | 30-hour comparison reuse and server-only, owner-scoped background comparison jobs. |
| `048_named_share_account_identity.sql` | Reconciles named sharing with the independently shipped 047 account identity store. Preserves canonical saved usernames and legacy reservations, repoints the named resolver, retains the old claim RPC as a wrapper and empties the copied legacy username table. Requires 045 and 047; applied and verified on the hosted project on 2026-11-07. |
| `047_account_usernames.sql` | Private account usernames and permanent name reservations, claimed atomically by the authenticated account. Apply before deploying account settings; name saves and existing app flows work without it, username controls report unavailable. |
| `029_card_price_history_evidence.sql` | Native dated TCGplayer quotes in `card_prices.history_points`, separate from current GBP prices and rolling averages |
| `030_tcg_card_illustrators.sql` | Browse by illustrator: partial index on `tcg_cards.illustrator` and `tcg_illustrator_directory()` (name + card count). The app falls back to paging `tcg_cards.illustrator` until it is applied; no backfill needed (the sync already stores `illustrator`) |
| `031_tcg_name_trigram_search.sql` | Enables `pg_trgm` (in the `extensions` schema) and adds a trigram GIN index on `tcg_cards.name_en`, so card search's `ILIKE '%text%'` uses an index instead of scanning every card. No code change needed; the app works before it is applied |
| `032_collection_activity_indexed_price_lookup.sql` | Collection writes: the `collection_activity_capture` trigger finds the slot's tracked prices by `card_prices` primary key instead of scanning every price row (~180 ms → ~7 ms per write). Same rows, same history; no code change |
| `033_rls_policies_initplan.sql` | RLS speed-up: every policy calls `(select auth.uid())` / `(select auth.jwt())` / `(select auth.role())` so it runs once per statement, and shared-collection checks use an uncorrelated `IN (select owner_user_id from partnerships …)`. Same access rules (`ALTER POLICY` in place). Adds `idx_partnerships_owner_user_id` |
| `034_drop_duplicate_and_unused_indexes.sql` | Index housekeeping: drops 12 duplicate or never-used indexes (less work on every write) and adds the two missing foreign-key indexes. Uses `CONCURRENTLY`, so run each statement on its own, outside a transaction. No code change |
| `035_collection_updated_at.sql` | Delta collection sync: adds `pokemon_collection.updated_at` (set by a trigger on every insert and update) and an index on `(user_id, updated_at)`. Refreshes then ask only for rows changed since the last sync plus a row count, instead of re-downloading the whole collection. The client falls back to full fetches until it is applied. Run the statements one at a time (the index is `CONCURRENTLY`) |
| `036_passkey_credentials_owner_only.sql` | Security: drops the `USING (true)` "Service can lookup credentials by id" policy on `passkey_credentials` (anyone could read every passkey row) and revokes signed-out access. Users still see their own rows; sign-in lookups must use the service-role client server-side. No code depends on it (passkey support is removed) |
| `037_price_triggers_skip_unchanged.sql` | Cheaper price writes: the native price-history trigger no longer does its work twice per upsert (it skips the discarded insert attempt when the row already exists), and both price-history triggers return early when a refresh brings the same prices on the same UTC day. Results are unchanged; the only difference is that today's analytics history rows keep their first `recorded_at` instead of being re-stamped by identical refreshes. `CREATE OR REPLACE`, safe to run live and to re-run. No code change |
| `038_pin_function_search_path.sql` | Security: sets an empty `search_path` on the job queue helper functions and `infer_card_finish_from_tcg_metadata`, which clears the advisor's mutable search path warnings. Their bodies are fully schema-qualified, so behaviour is unchanged. Safe to run live and to re-run; re-run after a job queue upgrade. No code change |
| `039_binders.sql` | Multiple binders, step 1 (additive): `binders` table (owner or partner can read; writes via `/api/binders`), one default "My binder" per owner, `pokemon_collection.binder_id` backfilled to the default, with composite FK `(binder_id, user_id) → binders(id, owner_user_id)` and a `BEFORE INSERT` trigger that fills a missing `binder_id` with the default (so older clients keep working). `binder_shares.binder_id` for per-binder links. Run the transactional part in one go, then each `CONCURRENTLY` index on its own. Old `UNIQUE (user_id, pokemon_id)` stays until `040` |
| `040_binders_finalize.sql` | Multiple binders, step 2 (apply after the binder-aware code is live): `pokemon_collection.binder_id` and `binder_shares.binder_id` become `NOT NULL`; drops `UNIQUE (user_id, pokemon_id)` (a Pokémon may sit in several binders; the slot key is `(binder_id, pokemon_id)`) and `binder_shares_owner_unique` (one link per binder) |
| `042_card_price_checks.sql` | Anonymous per-card/finish eBay asking and SaleHistory sold evidence, server-only refresh claims and 12-hour reuse. |
| `043_binder_history.sql` | Shared per-binder recent searches/cards for the owner and partner. Atomic entry upserts, server timestamps, bounded lists, per-device retry receipts and clear generations prevent stale offline history from returning. RLS reads, authenticated-only RPC writes; no legacy device history is uploaded. Before application, the app keeps scoped history/actions locally and reports shared history unavailable |
| `044_partner_push.sql` | Individual push subscriptions, private acquisition outbox and delivery claims, plus service-role-only atomic collection save. Apply before enabling VAPID enrollment; old code keeps working. |
| `045_named_binder_shares.sql` | Optional account usernames and per-owner binder slugs, transactional owner-only claims, permanent name reservations and RLS. Apply before enabling named links; existing token shares work without it. |
| `046_binder_value_visibility.sql` | Optional saved display preference for the binder value summary, default visible. Additive and compatible with older clients; apply before shipping the new toggle. |

| `001_create_pokemon_collection.sql` | `pokemon_collection` table (one row per collected Pokémon per user) with RLS |
| `002`, `003` | **Not in the repo.** These created `user_settings` (see below) and were applied before the repo was tracked |
| `004_create_tcg_mirror_tables.sql` | TCGdex mirror: `tcg_series`, `tcg_sets`, `tcg_cards`, `tcg_card_dex_ids`, `tcg_card_external_sources`. Also read at runtime by `lib/card-db-sync.ts` (`getSchemaSqlPath`), so don't move or rename it |
| `005_add_tcg_card_image_languages.sql` | `tcg_cards.image_languages_json` |
| `006_partner_mode.sql` | Partner mode: `partner_invites`, `partnerships` |
| `007_shared_partner_collection.sql` | `partnerships.owner_user_id` so both partners share the owner's collection |
| `008_add_collection_status.sql` | `pokemon_collection.status` |
| `009_expand_collection_status_check.sql` | Allow `finalized` / `considering` / `wishlisted` statuses |
| `010_create_card_prices.sql` | `card_prices` cache |
| `011_create_binder_shares.sql` | `binder_shares` (read-only share links) |
| `012_add_binder_colors_to_user_settings.sql` | `user_settings.binder_color_id`, `binder_page_colors` |
| `013_add_binder_slot_glare_to_user_settings.sql` | `user_settings.binder_slot_glare_enabled` |
| `014_add_dark_mode_to_user_settings.sql` | `user_settings.dark_mode` |
| `015_card_languages_and_price_refresh.sql` | `card_language` on collection rows; `language`, market/good/low/high GBP amounts, `confidence`, `source_prices`, `trend_points` on `card_prices` |
| `016_card_finishes_wantlist_and_effects.sql` | Card finish, `wanted_cards` wantlist, `card_finish_effects_enabled` |
| `017_backfill_card_finish_from_tcg_metadata.sql` | Re-asserts the 015/016 columns (safe catch-up) and backfills card finishes from the TCG mirror |
| `018_card_price_market_and_good_targets.sql` | Catch-up for the 015 `card_prices` columns (market and good-buy targets) |
| `019_add_jumbo_card_finish.sql` | Allow the `jumbo` finish |
| `020_card_price_confidence_ranges.sql` | Catch-up for the low/high range, confidence and evidence columns on `card_prices` |
| `021_card_price_source_evidence.sql` | Per-source price evidence (`source_prices`) |
| `022_price_provider_observations.sql` | `price_provider_runs`, `card_price_observations`, `buy_signal` |
| `023_price_provider_pokepulse.sql` | Allow the `pokepulse` provider in the 022 constraints |
| `024_binder_appearances.sql` | Owner/partner binder appearance JSON with revision conflicts; private 5 MB artwork bucket. Apply before enabling appearance sync; existing collection/settings work without it. |
| `025_restore_legacy_not_null_contracts.sql` | Restore 008's `status NOT NULL` and the documented, reconstructed settings nullability contracts. Fill only NULL status/grid values with existing app defaults; preserve known timestamps, using migration time only when both were missing. Does not rerun historical card/price backfills. |
| `026_card_price_finishes.sql` | Exact printing and finish price evidence (`finish_prices`); existing cache writes work before application |

| `027_collection_analytics.sql` | Private committed collection activity and compact tracked daily price observations with 90-day retention. Apply before enabling history; the view tolerates missing tables. |
| `028_user_pricing_preferences.sql` | `user_settings.pricing_region`, `preferred_currency`, `preferred_card_language` (NULL = automatic from the browser locale). `/api/settings` falls back to the older columns until this is applied |


Migration `048` was also applied after `047`; the existing canonical username count was unchanged (one saved account). Legacy claims were empty, and no saved username was reset. The reconciliation verifier covers nonempty legacy claims, already-current canonical names, and deleted-account reservations across repeated application.

Migration `045` was applied to the existing hosted Supabase project on 2026-11-07 before the named-link release. Both new tables have RLS enabled; authenticated users can claim their own names through the RPCs but cannot invoke the public resolver. Service role can resolve enabled shares. No real names were claimed or backfilled.

Verification commands: `bun scripts/verify-named-binder-shares.ts --hosted-rollback` (idempotence, 29 authorization/reservation/resolution/deletion/reconciliation checks and rolled-back EXPLAIN ANALYZE), and `bun scripts/verify-named-binder-concurrency.ts --hosted-concurrency` (temporary synthetic accounts, concurrent claims and cleanup). The second command requires the migration to be applied and briefly persists its synthetic fixtures before removing them.

## `user_settings` (from the missing 002/003)

The app expects this table (see `lib/settings.ts` for the column mapping). For a fresh project, create it before applying `012`:

```sql
-- Reconstructed from how the app uses the table; not the original migration.
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  binder_rows INTEGER NOT NULL DEFAULT 4,
  binder_cols INTEGER NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- These policy names are used by migration 033.
CREATE POLICY "Users can view own settings" ON public.user_settings
  FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "Users can insert own settings" ON public.user_settings
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "Users can update own settings" ON public.user_settings
  FOR UPDATE USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
```

This baseline uses the policy names expected by migration 033. It is for fresh projects; do not replace policies on an existing hosted project with this bootstrap.


## Fresh-schema verification

The full numbered sequence was replayed on PostgreSQL 18 with synthetic Supabase auth/storage scaffolding on 2026-11-08. This verifies SQL ordering, missing-table guards and the reconstructed settings policies; it is not proof of a complete Supabase Auth/Storage installation. No hosted database was touched.

With `psql` installed, create a new empty local database for each verification run:

```sh
createdb holofolder_fresh_check
FRESH_SCHEMA_TEST_DATABASE_URL=postgresql://localhost/holofolder_fresh_check bun test tests/fresh-schema.test.ts
```

The verifier refuses remote hosts, databases without the `holofolder_fresh_` prefix and nonempty schemas. It creates synthetic local auth/storage scaffolding and leaves the resulting database for inspection; it never clears an existing database. It exercises a wishlisted row's timestamp/backfill, binder creation, RLS, settings policy names and rerunning the legacy passkey security fix. Auth/storage service behaviour still requires a real Supabase smoke test.
