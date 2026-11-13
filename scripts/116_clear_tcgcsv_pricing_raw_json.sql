-- 116: Clear raw_json on tcgcsv-pricing links. It held the whole matched TCGplayer product listing
-- (about 1.3 KB a row), which nothing reads: prices use source_card_id (productId) and source_set_id
-- (groupId). The price import no longer writes it. Idempotent.
-- Space is reclaimed only by a table rewrite: run `VACUUM FULL public.tcg_card_external_sources` afterwards.
BEGIN;
SET LOCAL lock_timeout='3s';
UPDATE public.tcg_card_external_sources SET raw_json='{}'::jsonb
WHERE source='tcgcsv-pricing' AND raw_json <> '{}'::jsonb;
COMMIT;
