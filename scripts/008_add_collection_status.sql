ALTER TABLE public.pokemon_collection
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'collected';

UPDATE public.pokemon_collection
SET status = 'collected'
WHERE status IS NULL OR btrim(status) = '';

CREATE INDEX IF NOT EXISTS idx_pokemon_collection_status
  ON public.pokemon_collection(status);
