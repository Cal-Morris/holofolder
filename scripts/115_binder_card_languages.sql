-- 115: per-binder card languages for the "All <Pokémon> cards" sheet. NULL means English only (the app default).
-- Written through PATCH /api/binders (owner or partner via the service role), like the binder name.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.binders ADD COLUMN IF NOT EXISTS card_languages text[];
ALTER TABLE public.binders DROP CONSTRAINT IF EXISTS binders_card_languages_check;
ALTER TABLE public.binders ADD CONSTRAINT binders_card_languages_check CHECK (
  card_languages IS NULL OR (
    cardinality(card_languages) BETWEEN 1 AND 8
    AND card_languages <@ ARRAY['en', 'fr', 'de', 'es', 'it', 'pt-br', 'ja', 'ko']::text[]
  )
);
COMMIT;
