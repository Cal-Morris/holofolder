-- Multiple binders, step 2 of 2. Apply only after the binder-aware code (upserts on "binder_id,pokemon_id",
-- share links upserted on "owner_user_id,binder_id") is live; older code upserting on "user_id,pokemon_id"
-- would fail once the old unique is gone.
-- * binder_id is required (039 backfilled every row and its trigger fills new ones).
-- * The same Pokémon may now sit in several binders of one owner: UNIQUE (user_id, pokemon_id) is dropped;
--   pokemon_collection_binder_pokemon_unique (binder_id, pokemon_id) from 039 is the slot key.
-- * One share link per binder: UNIQUE (owner_user_id) on binder_shares is dropped;
--   binder_shares_owner_binder_unique from 039 is the key.
-- idx_pokemon_collection_user_updated_at (user_id, updated_at) stays: it serves owner-wide reads (RLS, all-binders
-- views and the price-refresh workflow) now that the old unique index is gone.
-- Idempotent; one transaction.

SET lock_timeout = '3s';

-- A NOT NULL check scans the table once under an ACCESS EXCLUSIVE lock; the table is small (~1k rows).
ALTER TABLE public.pokemon_collection ALTER COLUMN binder_id SET NOT NULL;
ALTER TABLE public.pokemon_collection DROP CONSTRAINT IF EXISTS pokemon_collection_user_id_pokemon_id_key;

ALTER TABLE public.binder_shares ALTER COLUMN binder_id SET NOT NULL;
ALTER TABLE public.binder_shares DROP CONSTRAINT IF EXISTS binder_shares_owner_unique;
