-- Index housekeeping.
-- Drops indexes that duplicate another index (same columns, or a leading prefix of a unique index) or
-- have never been used, so every write maintains fewer indexes. Adds the two foreign-key indexes the
-- Supabase performance advisor flagged. Nothing here changes query results.
--
-- CONCURRENTLY can't run inside a transaction: run each statement on its own (psql autocommit, or one
-- statement at a time in the SQL editor). Idempotent: IF EXISTS / IF NOT EXISTS throughout.

-- pokemon_collection
-- (user_id) is the leading column of the unique (user_id, pokemon_id) index.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_pokemon_collection_user_id;
-- Default-opclass GIN on wanted_cards: never used. collection_analytics_wanted_identity
-- (jsonb_path_ops, migration 027) serves the @> lookups.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_pokemon_collection_wanted_cards;

-- partnerships: user1 indexes duplicate each other and the unique (user1_id, user2_id); user2 has two copies.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_partnerships_user1;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_partnerships_user1_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_partnerships_user2;

-- partner_invites: two copies each of (inviter_id) and (invitee_email).
DROP INDEX CONCURRENTLY IF EXISTS public.idx_partner_invites_inviter;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_partner_invites_email;

-- binder_shares: token and owner_user_id already have unique indexes.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_binder_shares_token;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_binder_shares_owner_user_id;

-- passkey_credentials: credential_id already has a unique index.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_passkey_credential_id;

-- tcg_cards
-- (set_id) is the leading column of tcg_cards_set_local_unique and idx_tcg_cards_set_local_sort.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tcg_cards_set_id;
-- B-tree on name_en: never used. Name search is ILIKE '%…%', served by idx_tcg_cards_name_en_trgm (031).
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tcg_cards_name_en;

-- Foreign keys without a covering index (advisor: unindexed_foreign_keys).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tcgdex_cache_jobs_requested_by ON public.tcgdex_cache_jobs(requested_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_card_price_observations_run_id ON public.card_price_observations(run_id);
