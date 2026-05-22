ALTER TABLE public.pokemon_collection
ADD COLUMN IF NOT EXISTS card_language TEXT NOT NULL DEFAULT 'en';

UPDATE public.pokemon_collection
SET card_language = 'en'
WHERE card_language IS NULL OR card_language = '';

ALTER TABLE public.pokemon_collection
DROP CONSTRAINT IF EXISTS pokemon_collection_card_language_check;

ALTER TABLE public.pokemon_collection
ADD CONSTRAINT pokemon_collection_card_language_check
CHECK (card_language IN ('en', 'fr', 'de', 'es', 'it', 'pt-br', 'ja', 'ko'));

CREATE INDEX IF NOT EXISTS idx_pokemon_collection_card_language
  ON public.pokemon_collection(card_language)
  WHERE card_id IS NOT NULL;

ALTER TABLE public.card_prices
ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';

UPDATE public.card_prices
SET language = 'en'
WHERE language IS NULL OR language = '';

ALTER TABLE public.card_prices
DROP CONSTRAINT IF EXISTS card_prices_language_check;

ALTER TABLE public.card_prices
ADD CONSTRAINT card_prices_language_check
CHECK (language IN ('en', 'fr', 'de', 'es', 'it', 'pt-br', 'ja', 'ko'));

ALTER TABLE public.card_prices
DROP CONSTRAINT IF EXISTS card_prices_pkey;

ALTER TABLE public.card_prices
ADD CONSTRAINT card_prices_pkey
PRIMARY KEY (card_id, language);
