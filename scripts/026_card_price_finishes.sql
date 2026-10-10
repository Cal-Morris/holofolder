ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS finish_prices JSONB NOT NULL DEFAULT '[]'::jsonb;
