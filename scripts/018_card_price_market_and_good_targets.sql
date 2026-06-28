ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS market_gbp_amount NUMERIC(10, 2);

ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS good_gbp_amount NUMERIC(10, 2);

ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS low_gbp_amount NUMERIC(10, 2);

ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS high_gbp_amount NUMERIC(10, 2);

ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS source_prices JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS trend_points JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.card_prices
SET market_gbp_amount = gbp_amount
WHERE market_gbp_amount IS NULL
  AND gbp_amount IS NOT NULL;

UPDATE public.card_prices
SET low_gbp_amount = LEAST(COALESCE(good_gbp_amount, market_gbp_amount, gbp_amount), COALESCE(market_gbp_amount, gbp_amount)),
    high_gbp_amount = GREATEST(COALESCE(good_gbp_amount, market_gbp_amount, gbp_amount), COALESCE(market_gbp_amount, gbp_amount)),
    confidence = CASE
      WHEN source IN ('tcgplayer', 'cardmarket') AND good_gbp_amount IS NOT NULL THEN 'medium'
      WHEN source IN ('tcgplayer', 'cardmarket') THEN 'low'
      ELSE 'unknown'
    END
WHERE gbp_amount IS NOT NULL
  AND (low_gbp_amount IS NULL OR high_gbp_amount IS NULL OR confidence = 'unknown');

ALTER TABLE public.card_prices
DROP CONSTRAINT IF EXISTS card_prices_confidence_check;

ALTER TABLE public.card_prices
ADD CONSTRAINT card_prices_confidence_check
CHECK (confidence IN ('high', 'medium', 'low', 'unknown'));
