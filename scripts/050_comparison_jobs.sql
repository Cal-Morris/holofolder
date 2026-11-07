-- Comparison checks are shared for 30 hours; failed reservations still cool down for two minutes.
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.claim_card_price_check(p_card_id TEXT, p_finish TEXT, p_source TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.card_price_checks(card_id, finish, source)
    VALUES (p_card_id, p_finish, p_source) ON CONFLICT DO NOTHING;
  UPDATE public.card_price_checks SET next_attempt_at = now() + interval '2 minutes'
    WHERE card_id = p_card_id AND finish = p_finish AND source = p_source
      AND next_attempt_at <= now()
      AND (checked_at IS NULL OR checked_at <= now() - interval '30 hours');
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_card_price_check(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_card_price_check(TEXT, TEXT, TEXT) TO service_role;

-- Server-only jobs survive browser suspension. The account owner scopes every API read/write.
CREATE TABLE IF NOT EXISTS public.comparison_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_key TEXT NOT NULL,
  targets JSONB NOT NULL,
  progress JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed')),
  run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS comparison_jobs_active_scope ON public.comparison_jobs(owner_user_id, scope_key)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS comparison_jobs_owner ON public.comparison_jobs(owner_user_id, created_at DESC);
ALTER TABLE public.comparison_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comparison_jobs FROM anon, authenticated;
GRANT ALL ON public.comparison_jobs TO service_role;
