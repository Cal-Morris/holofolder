ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS buy_signal JSONB;

CREATE TABLE IF NOT EXISTS public.price_provider_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  card_id TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  CONSTRAINT price_provider_runs_provider_check
    CHECK (provider IN ('tcgplayer', 'cardmarket', 'ebay', 'pricecharting', 'pokescope', 'eyevo', 'public-page')),
  CONSTRAINT price_provider_runs_status_check
    CHECK (status IN ('started', 'succeeded', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_price_provider_runs_card
  ON public.price_provider_runs (card_id, language, started_at DESC);

CREATE TABLE IF NOT EXISTS public.card_price_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES public.price_provider_runs(id) ON DELETE SET NULL,
  card_id TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  provider TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  condition TEXT,
  sold_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  match_score INTEGER NOT NULL DEFAULT 0,
  match_rating TEXT NOT NULL DEFAULT 'rejected',
  match_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  reject_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT card_price_observations_provider_check
    CHECK (provider IN ('tcgplayer', 'cardmarket', 'ebay', 'pricecharting', 'pokescope', 'eyevo', 'public-page')),
  CONSTRAINT card_price_observations_currency_check
    CHECK (currency IN ('USD', 'EUR', 'GBP')),
  CONSTRAINT card_price_observations_match_rating_check
    CHECK (match_rating IN ('exact', 'strong', 'weak', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_card_price_observations_card
  ON public.card_price_observations (card_id, language, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_card_price_observations_sold
  ON public.card_price_observations (card_id, language, sold_at DESC)
  WHERE sold_at IS NOT NULL;

ALTER TABLE public.price_provider_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_price_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read price provider runs" ON public.price_provider_runs;
CREATE POLICY "Anyone can read price provider runs"
  ON public.price_provider_runs FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can read card price observations" ON public.card_price_observations;
CREATE POLICY "Anyone can read card price observations"
  ON public.card_price_observations FOR SELECT
  USING (true);
