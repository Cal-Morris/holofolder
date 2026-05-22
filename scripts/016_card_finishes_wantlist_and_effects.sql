ALTER TABLE public.pokemon_collection
ADD COLUMN IF NOT EXISTS card_finish TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE public.pokemon_collection
DROP CONSTRAINT IF EXISTS pokemon_collection_card_finish_check;

ALTER TABLE public.pokemon_collection
ADD CONSTRAINT pokemon_collection_card_finish_check
CHECK (card_finish IN (
  'normal',
  'holo',
  'reverse_holo',
  'illustration_rare',
  'special_illustration_rare',
  'secret_rare',
  'hyper_rare'
));

ALTER TABLE public.pokemon_collection
ADD COLUMN IF NOT EXISTS wanted_cards JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.pokemon_collection
SET wanted_cards = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
  'card_id', card_id,
  'card_name', card_name,
  'card_image', card_image,
  'card_set', card_set,
  'card_language', card_language,
  'card_finish', card_finish,
  'added_at', COALESCE(collected_at, now()::text)
)))
WHERE status = 'wishlisted'
  AND card_id IS NOT NULL
  AND wanted_cards = '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_pokemon_collection_wanted_cards
  ON public.pokemon_collection USING GIN (wanted_cards);

ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS card_finish_effects_enabled BOOLEAN NOT NULL DEFAULT true;
