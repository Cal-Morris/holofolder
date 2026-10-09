-- PokePulse is already a live price provider in lib/card-pricing.ts (source = 'pokepulse'),
-- but the provider check constraints from 022 did not allow it, so runs/observations from
-- PokePulse could never be recorded. Re-create the constraints with the full provider list.

ALTER TABLE public.price_provider_runs
DROP CONSTRAINT IF EXISTS price_provider_runs_provider_check;

ALTER TABLE public.price_provider_runs
ADD CONSTRAINT price_provider_runs_provider_check
CHECK (provider IN ('tcgplayer', 'cardmarket', 'ebay', 'pricecharting', 'pokescope', 'pokepulse', 'eyevo', 'public-page'));

ALTER TABLE public.card_price_observations
DROP CONSTRAINT IF EXISTS card_price_observations_provider_check;

ALTER TABLE public.card_price_observations
ADD CONSTRAINT card_price_observations_provider_check
CHECK (provider IN ('tcgplayer', 'cardmarket', 'ebay', 'pricecharting', 'pokescope', 'pokepulse', 'eyevo', 'public-page'));
