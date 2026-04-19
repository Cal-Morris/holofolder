-- Cached card prices, refreshed from tcgdex on demand.
CREATE TABLE IF NOT EXISTS public.card_prices (
  card_id TEXT PRIMARY KEY,
  gbp_amount NUMERIC(10, 2),
  original_amount NUMERIC(10, 2),
  original_currency TEXT,
  source TEXT,
  variant_label TEXT,
  source_updated_at TIMESTAMP WITH TIME ZONE,
  fx_date DATE,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_prices_fetched_at
  ON public.card_prices (fetched_at);

ALTER TABLE public.card_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read card prices" ON public.card_prices;
CREATE POLICY "Anyone can read card prices"
  ON public.card_prices FOR SELECT
  USING (true);

-- Writes are performed server-side with the service role key; no anon/authenticated write policy.
