ALTER TABLE public.pokemon_collection
DROP CONSTRAINT IF EXISTS pokemon_collection_status_check;

ALTER TABLE public.pokemon_collection
ADD CONSTRAINT pokemon_collection_status_check
CHECK (status = ANY (ARRAY['collected'::text, 'finalized'::text, 'considering'::text, 'wishlisted'::text]));
