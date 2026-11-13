-- Card search also filters tcg_cards.illustrator with ILIKE '%text%' (every search of 3+ characters) and
-- tcg_cards.id with ILIKE 'base1-44' (queries that look like a card id). Neither can use a b-tree, so both scanned
-- all ~40k cards (illustrator ~60 ms warm, id ~180 ms, seconds when the instance is busy). pg_trgm GIN indexes
-- serve both, like idx_tcg_cards_name_en_trgm (031) does for names.
-- Run each statement by itself, outside a transaction. Idempotent; the app behaves the same before and after.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tcg_cards_illustrator_trgm
  ON public.tcg_cards USING gin (illustrator extensions.gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tcg_cards_id_trgm
  ON public.tcg_cards USING gin (id extensions.gin_trgm_ops);
