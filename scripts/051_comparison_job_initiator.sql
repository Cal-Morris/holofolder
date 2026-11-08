-- New jobs notify the authenticated initiator, including when they are the owner’s partner.
-- Old jobs deliberately have no recipient.
SET lock_timeout = '3s';
ALTER TABLE public.comparison_jobs
  ADD COLUMN IF NOT EXISTS initiated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS comparison_jobs_initiator ON public.comparison_jobs(initiated_by);
