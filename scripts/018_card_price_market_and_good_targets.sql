ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS market_gbp_amount NUMERIC(10, 2);

ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS good_gbp_amount NUMERIC(10, 2);

UPDATE public.card_prices
SET market_gbp_amount = gbp_amount
WHERE market_gbp_amount IS NULL
  AND gbp_amount IS NOT NULL;
