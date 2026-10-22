-- Delta collection sync: pokemon_collection.updated_at, kept current by a trigger, so clients can fetch only the
-- rows that changed since their last sync instead of the whole collection on every refresh.
--
-- Live-safe: ADD COLUMN with a now() default is a catalog-only change (no table rewrite; existing rows read the
-- migration time). Run statements one at a time; the last one uses CONCURRENTLY, so not inside a transaction.
-- Idempotent. The app works before this is applied (it falls back to full fetches).

ALTER TABLE public.pokemon_collection ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Server-owned: always the database clock, whatever the client sends.
CREATE OR REPLACE FUNCTION public.set_pokemon_collection_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS pokemon_collection_set_updated_at ON public.pokemon_collection;

CREATE TRIGGER pokemon_collection_set_updated_at
  BEFORE INSERT OR UPDATE ON public.pokemon_collection
  FOR EACH ROW EXECUTE FUNCTION public.set_pokemon_collection_updated_at();

-- Serves "user_id = $1 AND updated_at > $2".
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pokemon_collection_user_updated_at
  ON public.pokemon_collection(user_id, updated_at);
