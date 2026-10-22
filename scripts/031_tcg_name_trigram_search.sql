-- Fast "contains" search on card names.
-- Card search filters tcg_cards.name_en with ILIKE '%text%', which can't use a b-tree index, so every
-- search scanned the whole table (~22k rows, ~185 ms per query). A pg_trgm GIN index serves ILIKE
-- '%text%' for queries of 3+ characters; shorter ones still fall back to a scan.
-- Idempotent: safe to re-run. The app works the same before and after it is applied (only faster).

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_tcg_cards_name_en_trgm
  ON public.tcg_cards USING gin (name_en extensions.gin_trgm_ops);
