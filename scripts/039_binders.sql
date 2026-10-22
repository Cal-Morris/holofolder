-- Multiple binders, step 1 of 2 (additive; the app running before this keeps working).
-- * public.binders: named binders per owner, exactly one default per owner.
-- * pokemon_collection.binder_id: every existing row is backfilled into its owner's default binder, and a
--   BEFORE INSERT trigger fills a missing binder_id with the owner's default, so clients that don't send one
--   keep working. The old UNIQUE (user_id, pokemon_id) stays until 040 (after the binder-aware code is live).
-- * binder_shares.binder_id: share links per binder (existing links point at the default binder).
-- Partners need nothing new: binders belong to the owner, and RLS uses the same partnerships check as the collection.
--
-- Apply the transactional part (everything above the CONCURRENTLY section) in one run, then each
-- CONCURRENTLY statement on its own. Idempotent: safe to re-run.

SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.binders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  -- Page size per binder; NULL inherits user_settings.binder_rows / binder_cols.
  binder_rows INTEGER,
  binder_cols INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT binders_id_owner_unique UNIQUE (id, owner_user_id),
  CONSTRAINT binders_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  CONSTRAINT binders_color_check CHECK (color IS NULL OR char_length(color) <= 32),
  CONSTRAINT binders_grid_check CHECK (
    (binder_rows IS NULL OR binder_rows BETWEEN 1 AND 6) AND (binder_cols IS NULL OR binder_cols BETWEEN 1 AND 6)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS binders_one_default_per_owner ON public.binders(owner_user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_binders_owner_sort ON public.binders(owner_user_id, sort_order);

CREATE OR REPLACE FUNCTION public.set_binders_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS binders_set_updated_at ON public.binders;
CREATE TRIGGER binders_set_updated_at BEFORE UPDATE ON public.binders
  FOR EACH ROW EXECUTE FUNCTION public.set_binders_updated_at();

ALTER TABLE public.binders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.binders FROM anon, authenticated;
GRANT SELECT ON public.binders TO authenticated;
GRANT ALL ON public.binders TO service_role;

-- Owner or partner can read; writes go through /api/binders with the service role after owner resolution.
DROP POLICY IF EXISTS "Read own or partner binders" ON public.binders;
CREATE POLICY "Read own or partner binders" ON public.binders FOR SELECT TO authenticated
  USING (
    owner_user_id = (select auth.uid())
    OR owner_user_id IN (
      SELECT p.owner_user_id FROM public.partnerships p
      WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
    )
  );

-- The owner's default binder, created on first use. Service-role only (also used by the insert trigger).
CREATE OR REPLACE FUNCTION public.ensure_default_binder(owner UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE found_id UUID;
BEGIN
  SELECT b.id INTO found_id FROM public.binders b WHERE b.owner_user_id = owner AND b.is_default;
  IF found_id IS NOT NULL THEN RETURN found_id; END IF;
  INSERT INTO public.binders(owner_user_id, name, sort_order, is_default)
  VALUES (owner, 'My binder', 0, true)
  ON CONFLICT (owner_user_id) WHERE is_default DO NOTHING;
  SELECT b.id INTO found_id FROM public.binders b WHERE b.owner_user_id = owner AND b.is_default;
  RETURN found_id;
END
$$;
REVOKE ALL ON FUNCTION public.ensure_default_binder(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_binder(UUID) TO service_role;

-- One default binder per existing collection owner and share owner.
INSERT INTO public.binders(owner_user_id, name, sort_order, is_default)
SELECT owners.user_id, 'My binder', 0, true
FROM (
  SELECT DISTINCT user_id FROM public.pokemon_collection
  UNION SELECT owner_user_id FROM public.binder_shares
) owners
WHERE owners.user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = owners.user_id)
ON CONFLICT (owner_user_id) WHERE is_default DO NOTHING;

-- Collection rows belong to a binder. Nullable here; 040 makes it NOT NULL.
ALTER TABLE public.pokemon_collection ADD COLUMN IF NOT EXISTS binder_id UUID;

UPDATE public.pokemon_collection c
SET binder_id = b.id
FROM public.binders b
WHERE c.binder_id IS NULL AND b.owner_user_id = c.user_id AND b.is_default;

-- The binder must belong to the row's owner; deleting a binder deletes its slots.
ALTER TABLE public.pokemon_collection DROP CONSTRAINT IF EXISTS pokemon_collection_binder_fkey;
ALTER TABLE public.pokemon_collection
  ADD CONSTRAINT pokemon_collection_binder_fkey FOREIGN KEY (binder_id, user_id)
  REFERENCES public.binders(id, owner_user_id) ON DELETE CASCADE;

-- Writes that don't name a binder (older clients) go to the owner's default.
CREATE OR REPLACE FUNCTION public.assign_pokemon_collection_binder()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.binder_id IS NULL THEN
    NEW.binder_id := public.ensure_default_binder(NEW.user_id);
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.assign_pokemon_collection_binder() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pokemon_collection_assign_binder ON public.pokemon_collection;
CREATE TRIGGER pokemon_collection_assign_binder BEFORE INSERT ON public.pokemon_collection
  FOR EACH ROW EXECUTE FUNCTION public.assign_pokemon_collection_binder();

-- Share links per binder. Existing links point at the default binder.
ALTER TABLE public.binder_shares ADD COLUMN IF NOT EXISTS binder_id UUID;
UPDATE public.binder_shares s
SET binder_id = b.id
FROM public.binders b
WHERE s.binder_id IS NULL AND b.owner_user_id = s.owner_user_id AND b.is_default;
ALTER TABLE public.binder_shares DROP CONSTRAINT IF EXISTS binder_shares_binder_fkey;
ALTER TABLE public.binder_shares
  ADD CONSTRAINT binder_shares_binder_fkey FOREIGN KEY (binder_id, owner_user_id)
  REFERENCES public.binders(id, owner_user_id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS binder_shares_owner_binder_unique
  ON public.binder_shares(owner_user_id, binder_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_binder_shares_binder_id ON public.binder_shares(binder_id);

-- ---- CONCURRENTLY: run each statement on its own, outside a transaction ----

-- One slot per Pokémon per binder (upsert target onConflict "binder_id,pokemon_id"); also covers the FK.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS pokemon_collection_binder_pokemon_unique
  ON public.pokemon_collection(binder_id, pokemon_id);

-- Delta sync per binder: "binder_id = $1 AND updated_at > $2".
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pokemon_collection_binder_updated_at
  ON public.pokemon_collection(binder_id, updated_at);
