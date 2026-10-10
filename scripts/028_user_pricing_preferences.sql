-- Pricing preferences on user_settings: region, display currency and preferred card language.
-- NULL means "automatic" (resolved on the device from the browser locale; see lib/pricing-region.ts).
-- Idempotent. Until this is applied, /api/settings falls back to the pre-024 columns and these
-- preferences stay in the device's local settings cache.

ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS pricing_region TEXT;

ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS preferred_currency TEXT;

ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS preferred_card_language TEXT;

ALTER TABLE public.user_settings
DROP CONSTRAINT IF EXISTS user_settings_pricing_region_check;

ALTER TABLE public.user_settings
ADD CONSTRAINT user_settings_pricing_region_check
CHECK (pricing_region IS NULL OR pricing_region IN ('UK', 'EU', 'US', 'JP'));

ALTER TABLE public.user_settings
DROP CONSTRAINT IF EXISTS user_settings_preferred_currency_check;

ALTER TABLE public.user_settings
ADD CONSTRAINT user_settings_preferred_currency_check
CHECK (preferred_currency IS NULL OR preferred_currency IN ('GBP', 'EUR', 'USD', 'JPY'));

ALTER TABLE public.user_settings
DROP CONSTRAINT IF EXISTS user_settings_preferred_card_language_check;

ALTER TABLE public.user_settings
ADD CONSTRAINT user_settings_preferred_card_language_check
CHECK (preferred_card_language IS NULL OR preferred_card_language IN ('en', 'fr', 'de', 'es', 'it', 'pt-br', 'ja', 'ko'));
