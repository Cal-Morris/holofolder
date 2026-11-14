-- public_illustrator_directory() (137) needs each credit's set as well as its name; without this it reads every wide
-- card row and took 5 to 12 seconds, past PostgREST's statement timeout. Covers both columns for an index-only scan.
-- Run this statement by itself, outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tcg_cards_illustrator_set
 ON public.tcg_cards(illustrator, set_id)
 WHERE illustrator IS NOT NULL AND btrim(illustrator)<>'' AND set_id<>'jumbo';
