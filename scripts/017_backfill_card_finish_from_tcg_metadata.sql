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

ALTER TABLE public.pokemon_collection
ADD COLUMN IF NOT EXISTS card_finish TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE public.pokemon_collection
ADD COLUMN IF NOT EXISTS wanted_cards JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS card_finish_effects_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.infer_card_finish_from_tcg_metadata(
  rarity TEXT,
  local_id TEXT,
  official_card_count INTEGER,
  variants JSONB
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(COALESCE(rarity, '')) LIKE '%ace spec%' THEN 'ace_spec'
    WHEN lower(COALESCE(rarity, '')) LIKE '%amazing%' THEN 'amazing_rare'
    WHEN lower(COALESCE(rarity, '')) LIKE '%radiant%' THEN 'radiant_rare'
    WHEN lower(COALESCE(rarity, '')) LIKE '%shiny%' THEN 'shiny_rare'
    WHEN lower(COALESCE(rarity, '')) LIKE '%special illustration%' THEN 'special_illustration_rare'
    WHEN lower(COALESCE(rarity, '')) LIKE '%illustration%' THEN 'illustration_rare'
    WHEN lower(COALESCE(rarity, '')) LIKE '%hyper%' THEN 'hyper_rare'
    WHEN lower(COALESCE(rarity, '')) LIKE '%ultra%' THEN 'ultra_rare'
    WHEN lower(COALESCE(rarity, '')) LIKE '%double%' THEN 'double_rare'
    WHEN (
      local_id ~ '[0-9]+'
      AND official_card_count IS NOT NULL
      AND (substring(local_id FROM '[0-9]+'))::INTEGER > official_card_count
    ) OR lower(COALESCE(rarity, '')) LIKE '%secret%' THEN 'secret_rare'
    WHEN COALESCE((variants ->> 'holo')::BOOLEAN, false) THEN 'holo'
    WHEN COALESCE((variants ->> 'reverse')::BOOLEAN, false) THEN 'reverse_holo'
    ELSE 'normal'
  END
$$;

ALTER TABLE public.pokemon_collection
DROP CONSTRAINT IF EXISTS pokemon_collection_card_finish_check;

ALTER TABLE public.pokemon_collection
ADD CONSTRAINT pokemon_collection_card_finish_check
CHECK (card_finish IN (
  'normal',
  'holo',
  'reverse_holo',
  'double_rare',
  'ultra_rare',
  'illustration_rare',
  'special_illustration_rare',
  'secret_rare',
  'hyper_rare',
  'radiant_rare',
  'ace_spec',
  'amazing_rare',
  'shiny_rare'
));

UPDATE public.pokemon_collection
SET wanted_cards = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
  'card_id', card_id,
  'card_name', card_name,
  'card_image', card_image,
  'card_set', card_set,
  'card_language', card_language,
  'card_finish', card_finish,
  'added_at', COALESCE(collected_at::text, now()::text)
)))
WHERE status = 'wishlisted'
  AND card_id IS NOT NULL
  AND wanted_cards = '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_pokemon_collection_card_language
  ON public.pokemon_collection(card_language)
  WHERE card_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pokemon_collection_wanted_cards
  ON public.pokemon_collection USING GIN (wanted_cards);

WITH inferred_owned_cards AS (
  SELECT
    collection.id,
    public.infer_card_finish_from_tcg_metadata(
      card.rarity,
      card.local_id,
      tcg_set.official_card_count,
      card.variants_json
    ) AS inferred_finish
  FROM public.pokemon_collection collection
  JOIN public.tcg_cards card
    ON card.id = collection.card_id
  JOIN public.tcg_sets tcg_set
    ON tcg_set.id = card.set_id
  WHERE collection.card_id IS NOT NULL
    AND COALESCE(NULLIF(collection.card_finish, ''), 'normal') = 'normal'
)
UPDATE public.pokemon_collection collection
SET card_finish = inferred.inferred_finish
FROM inferred_owned_cards inferred
WHERE collection.id = inferred.id
  AND inferred.inferred_finish <> 'normal';

WITH wanted_card_entries AS (
  SELECT
    collection.id,
    entry.ordinality,
    entry.card_entry,
    public.infer_card_finish_from_tcg_metadata(
      card.rarity,
      card.local_id,
      tcg_set.official_card_count,
      card.variants_json
    ) AS inferred_finish
  FROM public.pokemon_collection collection
  CROSS JOIN LATERAL jsonb_array_elements(collection.wanted_cards) WITH ORDINALITY AS entry(card_entry, ordinality)
  LEFT JOIN public.tcg_cards card
    ON card.id = entry.card_entry ->> 'card_id'
  LEFT JOIN public.tcg_sets tcg_set
    ON tcg_set.id = card.set_id
  WHERE collection.wanted_cards <> '[]'::jsonb
),
rebuilt_wanted_cards AS (
  SELECT
    id,
    jsonb_agg(
      CASE
        WHEN inferred_finish IS NOT NULL
          AND inferred_finish <> 'normal'
          AND COALESCE(NULLIF(card_entry ->> 'card_finish', ''), 'normal') = 'normal'
        THEN jsonb_set(card_entry, '{card_finish}', to_jsonb(inferred_finish), true)
        ELSE card_entry
      END
      ORDER BY ordinality
    ) AS wanted_cards
  FROM wanted_card_entries
  GROUP BY id
)
UPDATE public.pokemon_collection collection
SET wanted_cards = rebuilt.wanted_cards
FROM rebuilt_wanted_cards rebuilt
WHERE collection.id = rebuilt.id
  AND collection.wanted_cards IS DISTINCT FROM rebuilt.wanted_cards;
