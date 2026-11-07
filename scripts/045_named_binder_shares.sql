-- Optional named links. Existing token shares and application writes remain compatible.
-- Inactive names stay reserved, including after an account/binder is deleted.
SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.account_usernames (
  username TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT account_usernames_format CHECK (
    char_length(username) BETWEEN 3 AND 30 AND username ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS account_usernames_one_active ON public.account_usernames(user_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS account_usernames_user ON public.account_usernames(user_id);

CREATE TABLE IF NOT EXISTS public.binder_public_slugs (
  -- The namespace survives account deletion so an old address cannot point at a new identity.
  owner_user_id UUID NOT NULL,
  slug TEXT NOT NULL,
  binder_id UUID REFERENCES public.binders(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (owner_user_id, slug),
  CONSTRAINT binder_public_slugs_format CHECK (
    char_length(slug) BETWEEN 1 AND 60 AND slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS binder_public_slugs_one_active ON public.binder_public_slugs(binder_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS binder_public_slugs_binder ON public.binder_public_slugs(binder_id);

ALTER TABLE public.account_usernames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.binder_public_slugs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own usernames" ON public.account_usernames;
CREATE POLICY "Read own usernames" ON public.account_usernames FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
DROP POLICY IF EXISTS "Read own binder slugs" ON public.binder_public_slugs;
CREATE POLICY "Read own binder slugs" ON public.binder_public_slugs FOR SELECT TO authenticated USING (owner_user_id = (select auth.uid()));
REVOKE ALL ON public.account_usernames, public.binder_public_slugs FROM anon, authenticated;
GRANT SELECT ON public.account_usernames, public.binder_public_slugs TO authenticated;
GRANT ALL ON public.account_usernames, public.binder_public_slugs TO service_role;

CREATE OR REPLACE FUNCTION public.set_account_username(requested_username TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor UUID := auth.uid();
  chosen TEXT := lower(btrim(requested_username));
  claimed TEXT;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF chosen IS NULL OR char_length(chosen) NOT BETWEEN 3 AND 30 OR chosen !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' THEN
    RAISE EXCEPTION 'Invalid username' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-binder-identity:' || actor::text, 0));
  UPDATE public.account_usernames SET is_active = false WHERE user_id = actor AND is_active;
  INSERT INTO public.account_usernames AS names (username, user_id, is_active) VALUES (chosen, actor, true)
    ON CONFLICT (username) DO UPDATE SET is_active = true WHERE names.user_id = actor
    RETURNING username INTO claimed;
  IF claimed IS NULL THEN RAISE EXCEPTION 'Username is taken or reserved' USING ERRCODE = '23505'; END IF;
  RETURN claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_binder_public_slug(requested_binder_id UUID, requested_slug TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor UUID := auth.uid();
  chosen TEXT := lower(btrim(requested_slug));
  claimed TEXT;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF chosen IS NULL OR char_length(chosen) NOT BETWEEN 1 AND 60 OR chosen !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' THEN
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

REVOKE ALL ON FUNCTION public.set_account_username(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_binder_public_slug(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_account_username(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_binder_public_slug(UUID, TEXT) TO authenticated;

-- Public pages call this with the server's service role. No identity directory is exposed over RPC.
CREATE OR REPLACE FUNCTION public.resolve_named_binder_share(requested_username TEXT, requested_slug TEXT)
RETURNS TABLE (owner_user_id UUID, binder_id UUID, token TEXT, is_enabled BOOLEAN)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT shares.owner_user_id, shares.binder_id, shares.token, shares.is_enabled
  FROM public.account_usernames names
  JOIN public.binder_public_slugs slugs ON slugs.owner_user_id = names.user_id
  JOIN public.binders binders ON binders.id = slugs.binder_id AND binders.owner_user_id = names.user_id
  JOIN public.binder_shares shares ON shares.owner_user_id = names.user_id AND shares.binder_id = binders.id
  WHERE names.username = requested_username AND names.is_active
    AND slugs.slug = requested_slug AND slugs.is_active AND shares.is_enabled;
$$;
REVOKE ALL ON FUNCTION public.resolve_named_binder_share(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_named_binder_share(TEXT, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
