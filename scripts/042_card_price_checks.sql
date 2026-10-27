-- Anonymous comparison evidence, shared by exact English card/finish and source.
-- No eBay listing IDs, sellers or user account information is retained.
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS public.card_price_checks (
  card_id TEXT NOT NULL,
  finish TEXT NOT NULL CHECK (finish IN ('normal', 'holo', 'reverse_holo', 'any')),
  source TEXT NOT NULL CHECK (source IN ('ebay', 'soldcomps')),
  result_json JSONB,
  checked_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, finish, source),
  CHECK (char_length(card_id) BETWEEN 1 AND 100),
  CHECK ((result_json IS NULL) = (checked_at IS NULL))
);
ALTER TABLE public.card_price_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_price_checks FROM anon, authenticated;
GRANT ALL ON public.card_price_checks TO service_role;

-- Claim before external work; concurrent checks share the stored result and failures back off.
CREATE OR REPLACE FUNCTION public.claim_card_price_check(p_card_id TEXT, p_finish TEXT, p_source TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.card_price_checks(card_id, finish, source)
    VALUES (p_card_id, p_finish, p_source) ON CONFLICT DO NOTHING;
  UPDATE public.card_price_checks SET next_attempt_at = now() + interval '2 minutes'
    WHERE card_id = p_card_id AND finish = p_finish AND source = p_source
      AND next_attempt_at <= now()
      AND (checked_at IS NULL OR checked_at <= now() - interval '12 hours');
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_card_price_check(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_card_price_check(TEXT, TEXT, TEXT) TO service_role;
