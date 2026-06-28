ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS source_prices JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS trend_points JSONB NOT NULL DEFAULT '[]'::jsonb;
