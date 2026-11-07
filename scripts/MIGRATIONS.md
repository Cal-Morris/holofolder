# Database migrations

The Supabase schema is defined by the numbered SQL files in this folder. There is no migration runner: apply them by hand (Supabase SQL editor or `psql`) in numeric order. Every file uses `IF NOT EXISTS` / `DROP … IF EXISTS` guards, so re-running one that is already applied is meant to be harmless, but keep a note of what production has had applied.

When you add a migration, use the next free number (`031_…`), keep it idempotent, and add a row below.

| File | What it does |
|---|---|
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

CREATE POLICY "Users manage their own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

Check this against production (`\d public.user_settings`) before relying on it.

| `047_billing_access.sql` | Stripe subscription access, separate permanent licences, fixed grandfather cutoff for existing accounts, staged enforcement, transactional card cap and paid partner/share policies. Apply before enabling billing; enforcement defaults off. |
