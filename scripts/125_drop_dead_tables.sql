-- Drops four retired tables that no app code reads or writes: the old price provider log (022),
-- the retired TCGdex cache job table, and the pre-migration pokemon_tcg_cache. They were empty
-- (one failed April job row in tcgdex_cache_jobs) and only showed up as unused-index advisor noise.
-- No CASCADE: if anything still depends on them the drop fails instead of taking it along.
DROP TABLE IF EXISTS public.card_price_observations;
DROP TABLE IF EXISTS public.price_provider_runs;
DROP TABLE IF EXISTS public.tcgdex_cache_jobs;
DROP TABLE IF EXISTS public.pokemon_tcg_cache;
