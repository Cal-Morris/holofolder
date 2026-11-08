-- Only for existing projects with the retired public.tcgdex_cache_jobs table.
-- Run this statement on its own, outside a transaction. Fresh projects skip it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tcgdex_cache_jobs_requested_by ON public.tcgdex_cache_jobs(requested_by);
