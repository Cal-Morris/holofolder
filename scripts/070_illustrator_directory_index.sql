-- The directory otherwise reads thousands of wide card-table blocks just to count names.
-- Run this statement by itself, outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tcg_cards_illustrator_directory
 ON public.tcg_cards(illustrator)
 WHERE illustrator IS NOT NULL AND btrim(illustrator)<>'' AND set_id<>'jumbo';
