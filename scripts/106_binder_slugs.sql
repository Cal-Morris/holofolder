-- Every binder gets a slug: the app address /app/<slug>/binder/<page> and the named share /@user/<slug>.
-- New binders are named after their preset (national, kanto, a set name), else their name; clashes get -1, -2 ….
-- Reuses binder_public_slugs (045): one active slug per binder, old slugs stay reserved to their owner.
SET lock_timeout = '3s';

-- Mirrors RESERVED_BINDER_SLUGS in lib/binders/url.ts: top-level app routes a binder address can't shadow.
CREATE OR REPLACE FUNCTION public.binder_slug_reserved(slug text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT slug = ANY (ARRAY['api','app-shell','auth','docs','e2e-harness','home','mcp','oauth','share','studio','u',
    'settings','admin','new','login','logout','account','inventory','dex','offline','help'])
$$;

CREATE OR REPLACE FUNCTION public.binder_slug_base(manifest jsonb, binder_name text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  source text := manifest->'source'->>'id';
  raw text := CASE
    WHEN source = 'national-dex' THEN 'national'
    WHEN source ~ '^(generation-|set:)' THEN coalesce(nullif(btrim(manifest->>'name'), ''), binder_name)
    ELSE binder_name END;
  s text;
BEGIN
  s := translate(lower(coalesce(raw, '')), 'áàâäãåéèêëíìîïóòôöõúùûüýÿçñ''’', 'aaaaaaeeeeiiiiooooouuuuyycn');
  s := btrim(left(btrim(regexp_replace(s, '[^a-z0-9]+', '-', 'g'), '-'), 50), '-');
  RETURN CASE WHEN s = '' THEN 'binder' ELSE s END;
END $$;

-- Idempotent: returns the binder's active slug, claiming the first free base, base-1, base-2 … if it has none.
CREATE OR REPLACE FUNCTION public.assign_binder_slug(target uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner uuid; base text; candidate text; n integer := 0; existing text;
BEGIN
  SELECT b.owner_user_id, public.binder_slug_base(s.preset_manifest, b.name) INTO owner, base
  FROM public.binders b
  LEFT JOIN public.storage_collection_state s ON s.collection_id = b.id AND s.owner_user_id = b.owner_user_id
  WHERE b.id = target;
  IF owner IS NULL THEN RETURN NULL; END IF;
  -- Same lock as set_binder_public_slug, so manual and automatic claims never race.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-binder-identity:' || owner::text, 0));
  SELECT slug INTO existing FROM public.binder_public_slugs WHERE binder_id = target AND is_active;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  LOOP
    candidate := CASE WHEN n = 0 THEN base ELSE base || '-' || n END;
    EXIT WHEN NOT public.binder_slug_reserved(candidate) AND NOT EXISTS (
      SELECT 1 FROM public.binder_public_slugs WHERE owner_user_id = owner AND slug = candidate AND binder_id IS DISTINCT FROM target);
    n := n + 1;
  END LOOP;
  INSERT INTO public.binder_public_slugs AS names (owner_user_id, slug, binder_id, is_active) VALUES (owner, candidate, target, true)
    ON CONFLICT (owner_user_id, slug) DO UPDATE SET is_active = true;
  RETURN candidate;
END $$;
REVOKE ALL ON FUNCTION public.binder_slug_reserved(text), public.binder_slug_base(jsonb, text), public.assign_binder_slug(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.binder_slug_reserved(text), public.binder_slug_base(jsonb, text), public.assign_binder_slug(uuid) TO service_role;

-- Deferred to commit so native creation's preset manifest (written after the binder row) names the slug.
-- Covers every insert path: ensure_default_binder, /api/binders, the developer API and create_collection_v1.
CREATE OR REPLACE FUNCTION public.binders_assign_slug() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.assign_binder_slug(NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.binders_assign_slug() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS binders_assign_slug ON public.binders;
CREATE CONSTRAINT TRIGGER binders_assign_slug AFTER INSERT ON public.binders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.binders_assign_slug();

-- Deleting a binder used to null its slug's binder_id, which Undo can't restore (081 marked it
-- public_slug_cascade). Without the FK the row keeps the deleted id: still reserved, resolving nothing
-- (readers join binders), and a binder restored by Undo gets its address back.
ALTER TABLE public.binder_public_slugs DROP CONSTRAINT IF EXISTS binder_public_slugs_binder_id_fkey;
CREATE OR REPLACE FUNCTION collection_audit_private.deletion_dependencies_v1(collection uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version',1,'collectionId',collection,'unsupported',
   to_jsonb(array_remove(ARRAY[
     CASE WHEN EXISTS(SELECT 1 FROM public.binder_history_state WHERE binder_id=collection)
       OR EXISTS(SELECT 1 FROM public.binder_history_entries WHERE binder_id=collection)
       OR EXISTS(SELECT 1 FROM public.binder_history_clients WHERE binder_id=collection) THEN 'search_history_cascade' END,
     CASE WHEN EXISTS(SELECT 1 FROM public.partner_acquisitions WHERE binder_id=collection) THEN 'push_delivery_cascade' END
   ],NULL)))
$$;

-- Partners open the owner's binders by slug, so they can read the slugs of binders they can read.
DROP POLICY IF EXISTS "Read slugs of readable binders" ON public.binder_public_slugs;
CREATE POLICY "Read slugs of readable binders" ON public.binder_public_slugs FOR SELECT TO authenticated
  USING (is_active AND EXISTS (SELECT 1 FROM public.binders b WHERE b.id = binder_id));

-- PostgREST computed field: select=...,slug:binder_slug on binders. Runs with the caller's RLS.
CREATE OR REPLACE FUNCTION public.binder_slug(public.binders) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT slug FROM public.binder_public_slugs WHERE binder_id = $1.id AND owner_user_id = $1.owner_user_id AND is_active LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.binder_slug(public.binders) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.binder_slug(public.binders) TO authenticated, service_role;

-- A reserved word can't be claimed by hand either. Otherwise unchanged from 045.
CREATE OR REPLACE FUNCTION public.set_binder_public_slug(requested_binder_id UUID, requested_slug TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor UUID := auth.uid();
  chosen TEXT := lower(btrim(requested_slug));
  claimed TEXT;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF chosen IS NULL OR char_length(chosen) NOT BETWEEN 1 AND 60 OR chosen !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
    OR public.binder_slug_reserved(chosen) THEN
    RAISE EXCEPTION 'Invalid binder slug' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-binder-identity:' || actor::text, 0));
  PERFORM 1 FROM public.binders WHERE id = requested_binder_id AND owner_user_id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the binder owner can change its address' USING ERRCODE = '42501'; END IF;
  UPDATE public.binder_public_slugs SET is_active = false WHERE binder_id = requested_binder_id AND is_active;
  INSERT INTO public.binder_public_slugs AS names (owner_user_id, slug, binder_id, is_active) VALUES (actor, chosen, requested_binder_id, true)
    ON CONFLICT (owner_user_id, slug) DO UPDATE SET is_active = true WHERE names.binder_id = requested_binder_id
    RETURNING slug INTO claimed;
  IF claimed IS NULL THEN RAISE EXCEPTION 'Binder slug is taken or reserved' USING ERRCODE = '23505'; END IF;
  RETURN claimed;
END;
$$;
REVOKE ALL ON FUNCTION public.set_binder_public_slug(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_binder_public_slug(UUID, TEXT) TO authenticated;

-- Backfill: default binder first, then the switcher order, so each owner's first National Dex is "national".
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT b.id FROM public.binders b
    WHERE NOT EXISTS (SELECT 1 FROM public.binder_public_slugs s WHERE s.binder_id = b.id AND s.is_active)
    ORDER BY b.owner_user_id, b.is_default DESC, b.sort_order, b.created_at, b.id
  LOOP PERFORM public.assign_binder_slug(r.id); END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
