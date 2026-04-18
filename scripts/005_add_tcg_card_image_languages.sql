ALTER TABLE public.tcg_cards
ADD COLUMN IF NOT EXISTS image_languages_json JSONB NOT NULL DEFAULT '[]'::jsonb;
